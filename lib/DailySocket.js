const packageJSON = require("../package.json"),
      path = require('path'),  
      web =  require('./web.js'),
      axios = require('axios'),
      qs = require('querystring'),
      $ = require('./helpers.js');

let Service, Characteristic, CustomTypes;



class DailySocket {
    constructor(log, config, api, owner, modeLight) { 
        if (modeLight === undefined) modeLight = false;   
        this.modeLight = modeLight;

        if (log.debug !== undefined) this.log = log;        
        else this.log = {info:log, debug:this.debug?log:function(){}, error:console.error};

        this._setConfig(config);
        this.port = this.config.port ? this.config.port : 0;
        this.webPath = path.resolve('/', './' + (this.config.webPath ? this.config.webPath : this.config.name.toLowerCase()) + '/'); 

        this.log.info("Initializing", this.name, this.modeLight);

        this.comType = $.CommunicationTypes.http;
        
        // On: Bool
        this.On = false;

        this.service = undefined;
        web.startServerForSocket(this);
    }

    webCallback(json){
        this.log.debug("Callback", json);
        if (this.service){
            if (json.state !== undefined){
                this.updateOnState(json.state);
            }
        }
        return true;
    }

    updateOnState(value){
        if (value != this.On) { 
            this.On = value;
            this.log.debug("Updating On State:", value)
            this.service
                .getCharacteristic(Characteristic.On)
                .updateValue(value);
        }
    }

    
    setConfig(config){
        this._setConfig(config);        
    }

    _setConfig(config){
        this.log.info("Updating Config for " + config.name);
        this.config = config || {}; 
        this.name = this.config && this.config.name ? this.config.name : "Air Socket";

        this.modes = this.config && this.config.modes ? this.config.modes : [];
              
        this.host = this.config.target; 
        this.host.base = `http://${this.host.name}:${this.host.port}`; 
        this.host.uris = {
            state: this.host.base + path.resolve('/', './' + this.host.paths.state),
            on: this.host.base + path.resolve('/', './' + this.host.paths.on),
            off: this.host.base + path.resolve('/', './' + this.host.paths.off),
            color: this.host.base + path.resolve('/', './' + this.host.paths.color),
            mode: this.host.base + path.resolve('/', './' + this.host.paths.mode),
        }                
        this.debug = this.config.debug || false;        
    }

    initCommunications(){
        this.On = null;
        this.getFromOutlet((err, v) => {
            this.updateOnState(v);
        })
    }

    getFromOutlet(callback){
        const self = this;
        axios.get(this.host.uris.state)
            .then(function (response) {
                self.log.debug("getFromOutlet: ", response.data, response.status, response.statusText);
                if (response.status == 200) {
                    callback(null, response.data[0].on);
                } else {
                    callback(`Status ${response.status}: ${response.statusText}`, this.On);
                }
                
            })
            .catch(function (error) {
                callback(error, self.On);
                self.log.error("getFromOutlet: ", error);
            });        
    }

    sendToOutlet(value, callback){
        const self = this;
        console.log(value?this.host.uris.on:this.host.uris.off);
        axios.get(value?this.host.uris.on:this.host.uris.off)
            .then(function (response) {
                self.log.debug("sendToOutlet: ", value, response.data, response.status, response.statusText);
                if (response.status == 200) {
                    callback(null);
                } else {
                    callback(`Status ${response.status}: ${response.statusText}`);
                }
                
            })
            .catch(function (error) {
                callback(error);
                self.log.error("sendToOutlet: ", error);
            });     
    }

    // Required
    getInUse (callback) {
        this.log.debug("getInUse :", this.On);
        callback(null, true);
    }

    getOn (callback) {
        this.getFromOutlet(function (error, powerOn) {
            if (error) {
                callback(error, this.On);
            } else {
                this.On = powerOn;
                this.log.debug("getOn :", this.On);
                callback(null, this.On);
            }
        }.bind(this));
    }

    setOn (value, callback) {
        if (value === undefined) {
            callback();
        } else {
            this.log.debug("setOn from/to:", this.On, value);
            var oldState = this.On;
            this.On = value;
            //if ((value == false) || (this.bChangeSth == false)) 
            {
                this.sendToOutlet(value, function (error) {
                    if (error) {
                        this.On = oldState;
                        callback(error);
                    } else {
                        callback(null);
                    }
                }.bind(this));
            } 
            // else {
            //     callback(null);
            // }
        }
    }

    getName(callback) {
        this.log.debug("getName :", this.name);
        callback(null, this.name);
    }

    getMode (callback) {
        this.log.debug("getMode");
        callback(null, 0);
    }

    setMode(val, callback){
        let self = this;
        this.log.debug("setMode", val, this.host.uris.mode);

        axios.post(this.host.uris.mode, qs.stringify({mode:val}), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          })
            .then(function (response) {
                self.log.debug("setMode: ", val, response.data, response.status, response.statusText);
                if (response.status == 200) {
                    callback(null);

                    if (val>=0 && val<self.modes.length) {
                        self.service.getCharacteristic(CustomTypes.LightModeLabel).updateValue(self.modes[val]);
                    } else {
                        self.service.getCharacteristic(CustomTypes.LightModeLabel).updateValue("Error");
                    }
                } else {
                    callback(`Status ${response.status}: ${response.statusText}`);
                }
                
            })
            .catch(function (error) {
                callback(error);
                self.log.error("setMode: ", error);
            });  
    }

    getModeLabel(callback){
        this.getMode( function(error, val) {
            if (val>=0 && val<this.modes.length) {
                callback(null, this.modes[val]);
            } else {
                callback("Invalid Mode", "Error");
            }
        }.bind(this));
        this.log.debug("getModeLabel");        
    }

    configureAccesory(acc){
        let infoService = acc.getService(Service.AccessoryInformation);
        let outletService = this.modeLight ? acc.getService(Service.Lightbulb) : acc.getService(Service.Outlet);
        this.configureServices(infoService, outletService);

        //Initialise  for talking to the bulb
        this.initCommunications();
    }

    configureServices(infoService, outletService){
        this.service = outletService;

        // Required Characteristics
        this.service
            .getCharacteristic(Characteristic.On)
            .on('get', this.getOn.bind(this))
            .on('set', this.setOn.bind(this));

        if (this.modeLight) {
            console.log(CustomTypes.LightMode);
            let lightModeC = this.service.getCharacteristic(CustomTypes.LightMode);
            let lightModeLabelC = this.service.getCharacteristic(CustomTypes.LightModeLabel);

            if (this.modes.length>0){
                if (lightModeC === undefined) lightModeC = this.service.addCharacteristic(CustomTypes.LightMode);
                if (lightModeLabelC === undefined) lightModeLabelC = this.service.addCharacteristic(CustomTypes.LightModeLabel);  
                
                this.log.debug(`Configuring for ${this.modes.length} modes.`)
                lightModeC.setProps({
                    format: Characteristic.Formats.UINT8,
                    maxValue: this.modes.length-1,
                    minValue: 0,
                    minStep: 1,
                    perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
                  })

                lightModeC
                    .on('get', this.getMode.bind(this))
                    .on('set', this.setMode.bind(this));

                lightModeLabelC
                    .on('get', this.getModeLabel.bind(this));
            } else {
                if (lightModeC !== undefined) this.service.removeCharacteristic(CustomTypes.LightMode);
                if (lightModeLabelC !== undefined) this.service.removeCharacteristic(CustomTypes.LightModeLabel);
            }
        } else {
            this.service
                .getCharacteristic(Characteristic.OutletInUse)
                .on('get', this.getInUse.bind(this));
        }
        
        this.service
            .getCharacteristic(Characteristic.Name)
            .on('get', this.getName.bind(this));
    }


    getServices () {
        if (this.service === undefined) {
            this.service = this.modeLight ? new Service.Lightbulb(this.name) : new Service.Outlet(this.name);

            this.service.addCharacteristic(Characteristic.Brightness);
            this.service.addCharacteristic(Characteristic.Hue);
            this.service.addCharacteristic(Characteristic.Saturation);
        }

        // you can OPTIONALLY create an information service if you wish to override
        // the default values for things like serial number, model, etc.
        const informationService = new Service.AccessoryInformation();

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Ambertation")
            .setCharacteristic(Characteristic.Model, "AirSwitch")
            .setCharacteristic(Characteristic.SerialNumber, "0000");

        this.configureServices(informationService, this.service);
        

        //Initialise  for talking to the bulb
        this.initCommunications();

        return [informationService, this.service];
    }
}

class DailyLight extends DailySocket{
    constructor(log, config, api, owner){
        super(log, config, api, owner, true);
        this.log.info("Initializing Light", this.name);
    }
}

module.exports = function(service, characteristic, customTypes){
    Service = service;
    Characteristic = characteristic;
    CustomTypes = customTypes;

    return {
        DailySocket:DailySocket,
        DailyLight:DailyLight
    }
}