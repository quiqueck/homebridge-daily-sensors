const packageJSON = require("../package.json"),
      path = require('path'),  
      web =  require('./web.js'),
      $ = require('./helpers.js');

let Service, Characteristic, Accessory, UUIDGen, DailySensor, DailyGroup, DailySocket, DailyLight;

let knownAccesories = [];
let knownPlatforms = [];
class DailyPlatform {
    constructor(log, config, api) {
        const self = this;
        
        this.config = config || {};
        this.debug = this.config.debug || false;
        this.name = this.config && this.config.name ? this.config.name : "Daily Platform";
        this.UUID = UUIDGen.generate("DailyPlatform." + this.name);
        knownPlatforms.push(this);
        //console.log("LST.INIT", this.name, this.UUID, process.argv);
        this.log = {info:log, debug:this.debug?log:function(){}, error:console.error};
        
        this.accessories = [];
        this.removeAfterStartup = [];
        this.port = this.config.port ? this.config.port : 0;    
        this.webPath = path.resolve('/', './' + (this.config.webPath ? this.config.webPath : this.name.toLowerCase()) + '/'); 
        this.btDevices = this.config.bluetoothDevices !== undefined ? this.config.bluetoothDevices : [];
        this.ble = {};
        if (this.config && this.config.bluetoothDevices && this.config.bluetoothDevices.length > 0){
            try {
                this.ble = require('./ble.js')(
                    this.log, 
                    this.btDevices, 
                    this.btEvent.bind(this)
                );
            } catch(e){
                this.log.error("Could Not Start Noble", e);
            }
        }

        if (api) {
            // Save the API object as plugin needs to register new accessory via this object
            this.api = api;
      
            // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
            // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.x
            // Or start discover new accessories.
            this.api.on('didFinishLaunching', function() {
              self.log.info("DidFinishLaunching " + this.config.name);
              this.api.unregisterPlatformAccessories("homebridge-daily-sensors", "DailyPlatform", this.removeAfterStartup);
              this.removeAfterStartup = undefined;

              if (this.config.accessories) {
                this.config.accessories.forEach(accConf => {
                    let acc = this.getKnownAccessoryWithName(accConf.name);
                    
                    if (acc){
                        this.log.debug("Reconfigure existing Accessory", accConf.name);
                        
                        acc = this.configureAccessoryOnPlatform(acc);
                        acc.setConfig(this.buildConfig(accConf));
                        acc.platformAccessory.context.userConfig = accConf;
                    } else {
                        this.log.debug("Creating new Accessory", accConf.name);
                        acc = this.addAccessory(accConf);
                    }                    
                    if (acc) acc.fixedConfig = true;
                })
              }

              if (this.ble.initAll){
                this.log.info("Initializing BLE");
                this.ble.initAll();
              }
            }.bind(this));
        } 
    }

    btEvent(e){
        //this.accessories.forEach(sensor => console.log(sensor.btSwitch, sensor.config.name))
        this.log.debug("Event:", e);
        if (e!==undefined && e.id !== undefined){
            this.accessories
                .filter(sensor => (
                    sensor instanceof DailyGroup || 
                    (sensor.bluetooth && sensor.bluetooth.id === e.id)
                ))
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

    createAccesory(config){
        if (config.accessory == 'DailySensors') {
            return new DailySensor(this.log, config, this.api, this);
        } else if (config.accessory == 'DailyGroup') {
            return new DailyGroup(this.log, config, this.api, this);
        } else if (config.accessory == 'DailySocket') {
            return new DailySocket(this.log, config, this.api, this);
        } else if (config.accessory == 'DailyLight') {
            return new DailyLight(this.log, config, this.api, this);
        } 
        this.log.error("  ... Unknown Accessory type '" + config.accessory + "'");
        return undefined;        
    }

    configureAccessory(accessory) {
        //console.log("LST.READ", accessory.displayName, accessory.UUID, accessory.context.platformUUID, '@', this.name, this.UUID);

        const pp = knownPlatforms.find(p=>p.UUID === accessory.context.platformUUID );    

        if (process.argv.some(v=>v==='-Q') && pp && !pp.config.accessories.some(v=>v.name == accessory.context.userConfig.name)) {
            //console.log("LST.D1", accessory.displayName, accessory.UUID, accessory.context.wasUsedInPlatform, accessory.context.platformUUID);
            this.log.error("Did no longer find '"+accessory.displayName+"'. Removing from list.");
            this.removeAfterStartup.push(accessory);
            return;
        } else if ((knownPlatforms.length>0 || process.argv.some(v=>v==='-Q')) && !knownPlatforms.some(v => v.UUID === accessory.context.platformUUID)) {
            //console.log("LST.D2", accessory.displayName, accessory.UUID, accessory.context.wasUsedInPlatform, accessory.context.platformUUID);
            this.log.error("WILL REMOVE", accessory.displayName);
            this.removeAfterStartup.push(accessory);
            return;
        }

        //console.log("LST.PUSH", accessory.displayName, accessory.UUID, accessory.context.platformUUID, '@', this.name, this.UUID);
        accessory.context.wasUsedInPlatform = false;

        knownAccesories.push(accessory);
    }

    configureAccessoryOnPlatform(accessory){
        //console.log("LST.CONF.P", accessory.displayName, accessory.UUID, accessory.context.platformUUID, '@', this.name, this.UUID);
        
        accessory.context.wasUsedInPlatform = true;
        this.log.info("Configure Accessory", accessory.displayName);
        var platform = this;
        
        const config = this.buildConfig(accessory.context.userConfig);
        //this.log.debug("   Configuration", config);
        const sensor = this.createAccesory(config);
        if (sensor === undefined) {
            this.log.error("  ... Falling back to DailySensors");
            sensor = new DailySensor(this.log, config, this.api, this);
        }

        sensor.platformAccessory = accessory;
        sensor.fixedConfig = false;

        accessory.on('identify', function(paired, callback) {
            sensor.identify();
            callback();
        });

        sensor.configureAccesory(accessory);
        this.linkSensor(sensor);

        return sensor;
    }

    addAccessory(inConfig) {
        const accessoryName = inConfig.name;
        this.log.info("Add Accessory", accessoryName);
        
        const uuid = UUIDGen.generate(accessoryName);
        //console.log("LST.ADD", accessoryName, uuid, '@', this.name, this.UUID);
        const newAccessory = new Accessory(accessoryName, uuid);
        const infoService = newAccessory.getService(Service.AccessoryInformation);

        const config = this.buildConfig(inConfig);
        const sensor = this.createAccesory(config);
        if (sensor === undefined) return;

        
        sensor.platformAccessory = newAccessory;
        sensor.fixedConfig = false;
        
        newAccessory.on('identify', function(paired, callback) {
          sensor.identify();
          callback();
        });
        // Plugin can save context on accessory to help restore accessory in configureAccessory()
        newAccessory.context.userConfig = inConfig;
        newAccessory.context.platformUUID = this.UUID;
        newAccessory.context.wasUsedInPlatform = true;
        
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

    removeAccessory(accessory) {
        this.log.info("Remove Accessory", accessory.displayName, accessory.UUID);
        this.api.unregisterPlatformAccessories("homebridge-daily-sensors", "DailyPlatform", [accessory]);
      
        this.accessories = this.accessories.filter(sensor => sensor.platformAccessory.UUID != accessory.UUID);
        this.log.debug(this.accessories);
    }

    getKnownAccessoryWithName(name){
        return knownAccesories.find(acc => acc.displayName == name);
    }

    getAccessoryWithName(name) {
        return this.accessories.find(acc => acc.config.name == name);
    }

    hasAccessoryWithName(name){
        return this.accessories.some(acc => acc.config.displayName == name);
    }
}

module.exports = function(service, characteristic, accessory, uuidGen, dailySensor, dailyGroup, dailySocket, dailyLight){
    Service = service;
    Characteristic = characteristic;
    Accessory = accessory;
    UUIDGen = uuidGen;
    DailySensor = dailySensor;
    DailyGroup = dailyGroup;
    DailySocket = dailySocket;
    DailyLight = dailyLight;
    

    return {
        DailyPlatform:DailyPlatform
    }
}