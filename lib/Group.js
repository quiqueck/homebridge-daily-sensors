const suncalc = require('suncalc'),
      moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),  
      holidays = require('date-holidays'), //https://www.npmjs.com/package/date-holidays#supported-countries-states-regions    
      ical = require('./iCal.js'),
      web =  require('./web.js'),
      $ = require('./helpers.js');

      let Service, Characteristic, DailySensor;

      
class DailyGroup {
    constructor(log, config, api, owner) {
        this.owner = owner;
        const self = this; 
        this.config = config === undefined ? {} : config;  
        this.debug = this.config.debug === undefined ? false : this.config.debug;
        this.fixedConfig = true; 
        this.items = [];
        this.subServices = [];
        
        if (log.debug !== undefined) this.log = log;        
        else this.log = {info:log, debug:this.debug?log:function(){}, error:console.error};
        if (this.config.debug !== undefined)
            this.log.debug = this.debug?this.log.info:function(){};

        this._setConfig(config);
        if (api) {
            this.api = api;        
            this.api.on('didFinishLaunching', function() {
                self.log.info("DidFinishLaunching", this.config.name);
            }.bind(this));
        }

        this.log.debug("Finished Initialization");
    }

    identify(callback) {
        this.log.info('Identify requested!');
        callback(null);
    }

    setConfig(config){
        this._setConfig(config);
    }

    _setConfig(config){
        this.log.info("Updating Config for " + config.name);
        this.config = config;             
        this.debug = this.config.debug || false;        
    }

    configureAccesory(acc){
        /*let infoService = acc.getService(Service.AccessoryInformation);
        let switchService = acc.getService(Service.StatelessProgrammableSwitch);
        let lusService = switchService; //acc.getService(Service.LightSensor);
        this.configureServices(infoService, lusService, switchService);*/
    }

    configureServices(informationService, labelService){ 
        const self = this;

        this.informationService = informationService;
        this.labelService = labelService;
    }

    configureServiceCharacteristics(informationService, labelService){       
        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Ambertation")
            .setCharacteristic(Characteristic.Model, "Daily Group")
            .setCharacteristic(Characteristic.SerialNumber, "0000")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

        this.configureServices(informationService, labelService)
    }

    getServices(useInfo) {         
        if (this.informationService == undefined){
            //Info about this plugin
            let informationService = useInfo;
            if (!useInfo) informationService = new Service.AccessoryInformation ();

            let labelService = new Service.ServiceLabel(this.name, '')
            labelService
                .getCharacteristic(Characteristic.ServiceLabelNamespace)
                .updateValue(Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS);

                
            
            const self = this;
            let counter = 0;
            this.config.items.forEach(subConf => {
                counter++;
                const name = subConf.name ? subConf.name : 'Item ' + counter;
                const type = subConf.accessory;
                if (type == 'DailySensors') {
                    self.log.debug("Creating '"+name+"' as '"+type+"'");
                    subConf.noLux = true;
                    subConf.noPowerState = true;
                    const sensor = new DailySensor(self.log, subConf, self.api);
                    self.items.push(sensor);
                    const services = sensor.getServices(informationService);
                    
                    services.forEach(service=>{
                        if (informationService.UUID != service.UUID) {
                            const sli = service.getCharacteristic(Characteristic.ServiceLabelIndex);
                            sli && sli.setValue(counter)
                            self.subServices.push(service);
                        }
                    });
                } else {
                    this.log.error("Unknown Type '"+type+"' for '"+name+"'");
                }
            });

            this.configureServiceCharacteristics(informationService, labelService);  
        }   
        
        let services = [this.informationService, this.labelService, ...this.subServices]; 
        console.log(services);
        return services;
    }
}

module.exports = function(service, characteristic, dailySensor){
    Service = service;
    Characteristic = characteristic;
    DailySensor = dailySensor;

    return {
        DailyGroup:DailyGroup
    }
}