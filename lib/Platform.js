const packageJSON = require("../package.json"),
      path = require('path'),  
      web =  require('./web.js'),
      $ = require('./helpers.js');

let Service, Characteristic, Accessory, UUIDGen, DailySensor;

class DailyPlatform {
    constructor(log, config, api) {
        const self = this;
        this.config = config || {};
        this.debug = this.config.debug || false;
        this.log = {info:log, debug:this.debug?log:function(){}, error:console.error};
        
        this.accessories = [];
this.port = this.config.port ? this.config.port : 0;    
        this.webPath = path.resolve('/', './' + (this.config.webPath ? this.config.webPath : this.config.name.toLowerCase()) + '/'); 
        this.btDevices = this.config.bluetoothDevices !== undefined ? this.config.bluetoothDevices : [];
        this.ble = require('./ble.js')(this.log, this.btDevices, this.btEvent.bind(this));

        if (api) {
            // Save the API object as plugin needs to register new accessory via this object
            this.api = api;
      
            // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
            // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
            // Or start discover new accessories.
            this.api.on('didFinishLaunching', function() {
              self.log.info("DidFinishLaunching " + this.config.name);
              if (this.config.accessories) {
                this.config.accessories.forEach(accConf => {
                    let acc = this.getAccessoryWithName(accConf.name);
                    if (acc){
                        this.log.debug("Reconfigure existing Accessory", accConf.name);
                        acc.setConfig(this.buildConfig(accConf));
                        acc.platformAccessory.context.userConfig = accConf;
                    } else {
                        this.log.debug("Creating new Accessory", accConf.name);
                        acc = this.addAccessory(accConf);
                    }
                    acc.fixedConfig = true;
                })
              }
            }.bind(this));
        } 
    }

    btEvent(e){
        //this.accessories.forEach(sensor => console.log(sensor.btSwitch, sensor.config.name))
        this.log.debug("Event:", e);
        if (e!==undefined && e.id !== undefined){
            this.accessories
                .filter(sensor => sensor.bluetooth.id === e.id)
                .forEach(sensor => sensor.receivedSwitchEvent(e));
        }
    }

    buildConfig(accConfig){
        let conf =  {
            locale:this.config.locale,
            port:this.port,
            debug:this.debug,
            location:this.config.location,
            ...accConfig
        }

        conf.webPath = path.resolve('/' + this.webPath + '/' +  conf.webPath);

        return conf;
    }

    linkSensor(sensor){
        //bluetoothSwitchID
        this.accessories.push(sensor);     
    }

    configureAccessory(accessory) {
        this.log.info("Configure Accessory", accessory.displayName);
        var platform = this;
        
        const config = this.buildConfig(accessory.context.userConfig);
        const sensor = new DailySensor(this.log, config, this.api);
        sensor.platformAccessory = accessory;
        sensor.fixedConfig = false;

        accessory.on('identify', function(paired, callback) {
            sensor.identify();
            callback();
        });

        sensor.configureAccesory(accessory);
        this.linkSensor(sensor);
    }

    addAccessory(inConfig) {
        const accessoryName = inConfig.name;
        this.log.info("Add Accessory", accessoryName, inConfig);
        
        const uuid = UUIDGen.generate(accessoryName);
        const newAccessory = new Accessory(accessoryName, uuid);
        const infoService = newAccessory.getService(Service.AccessoryInformation);

        const config = this.buildConfig(inConfig);
        const sensor = new DailySensor(this.log, config, this.api);   
        sensor.platformAccessory = newAccessory;
        sensor.fixedConfig = false;
        
        newAccessory.on('identify', function(paired, callback) {
          sensor.identify();
          callback();
        });
        // Plugin can save context on accessory to help restore accessory in configureAccessory()
        newAccessory.context.userConfig = inConfig;
        
        const services = sensor.getServices(infoService);
        let nr = 0;
        
        services.forEach(service=>{
            if (infoService.UUID != service.UUID) {
                newAccessory.addService(
                    service, 
                    accessoryName + " (" + service.internalName + ")"
                );
            }
        });
        
        this.linkSensor(sensor);
        this.api.registerPlatformAccessories("homebridge-daily-sensors", "DailyPlatform", [newAccessory]);

        return sensor;
    }

    getAccessoryWithName(name) {
        return this.accessories.find(acc => acc.config.name == name);
    }

    hasAccessoryWithName(name){
        return this.accessories.some(acc => acc.config.displayName == name);
    }
}

module.exports = function(service, characteristic, accessory, uuidGen, dailySensor){
    Service = service;
    Characteristic = characteristic;
    Accessory = accessory;
    UUIDGen = uuidGen;
    DailySensor = dailySensor;
    

    return {
        DailyPlatform:DailyPlatform
    }
}