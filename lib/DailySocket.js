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
        
        this.debug = config.debug === undefined ? false : config.debug;
        if (log.debug !== undefined) this.log = log;        
        else this.log = {info:log, debug:this.debug?console.log:function(){}, error:console.error};
        if (config.debug !== undefined)
            this.log.debug = this.debug?this.log.info:function(){};
        

        this._setConfig(config);
        this.port = this.config.port ? this.config.port : 0;
        this.webPath = path.resolve('/', './' + (this.config.webPath ? this.config.webPath : this.config.name.toLowerCase()) + '/'); 

        this.log.info("Initializing", this.name, this.modeLight);

        this.comType = $.CommunicationTypes.http;
        this.mode = 1;
        this.speed = 20;
        this.brightness = 100;
        this.hue = 0;
        this.saturation = 100;
        
        // On: Bool
        this.On = false;

        this.service = undefined;
        web.startServerForSocket(this);
    }

    webCallback(json){
        this.log.debug("Callback", json);
        if (this.service){
            if (json.on !== undefined){
                this.updateOnState(json.on);                
            }
            if (this.modeLight){
                this.updateBrightness(Math.round((json.v / 0xFF) * 100));
                this.updateSaturation(Math.round((json.s / 0xFF) * 100));
                this.updateHue(Math.round((json.h / 0xFF) * 100));

                this.updateMode(json.mode);
                this.updateSpeed(json.speed);
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

    updateBrightness(value){
        if (value != this.brightness && this.modeLight) { 
            this.brightness = value;
            this.log.debug("Updating Brightness:", value)
            this.service
                .getCharacteristic(Characteristic.Brightness)
                .updateValue(value);
        }
    }

    updateHue(value){
        if (value != this.hue && this.modeLight) { 
            this.hue = value;
            this.log.debug("Updating Hue:", value)
            this.service
                .getCharacteristic(Characteristic.Hue)
                .updateValue(value);
        }
    }

    updateSaturation(value){
        if (value != this.saturation && this.modeLight) { 
            this.saturation = value;
            this.log.debug("Updating Saturation:", value)
            this.service
                .getCharacteristic(Characteristic.Saturation)
                .updateValue(value);
        }
    }

    updateMode(val){
        if (val != this.mode && this.modeLight) { 
            this.mode = val
            this.log.debug("Updating Mode:", val);

            this.service
                .getCharacteristic(CustomTypes.LightMode)
                .updateValue(val);
            if (val>=0 && val<this.modes.length) {                        
                this.service.getCharacteristic(CustomTypes.LightModeLabel).updateValue(this.modes[val]);
            } else {
                this.service.getCharacteristic(CustomTypes.LightModeLabel).updateValue("Error");
            }
        }
    }

    updateSpeed(value){
        if (value != this.speed && this.modeLight) { 
            this.speed = value;
            this.log.debug("Updating Speed:", value)
            this.service
                .getCharacteristic(Characteristic.RotationSpeed)
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

        this.log.debug("Modes", this.config.modes);
        this.modes = this.config && this.config.modes ? this.config.modes : [];
        this.maxSpeed = this.config && this.config.maxSpeed ? this.config.maxSpeed : 150;
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
        this.getFromOutlet((err, json) => {
            //console.log("TEST", err, json)
            if (err){
                this.log.error(err);
                this.service
                    .getCharacteristic(Characteristic.On).

                return
            } else {
                if (json.on !== undefined){
                    this.updateOnState(json.on);                
                }
                if (this.modeLight){
                    this.updateBrightness(json.v);
                    this.updateSaturation(json.s);
                    this.updateHue(json.h);

                    this.updateMode(json.mode);
                    this.updateSpeed(json.speed);
                }
            }
        })
    }

    retries = []
    retryGetFromOutlet(host, callback, retryCount){
        const self = this
        if (this.retries.indexOf(host.uris.state)>=0){
            return;
        }
        this.retries.push(host.uris.state)
        self.log.error(`    Will retry in ${retryIn}s`)
        if (retryCount ===undefined) retryCount = 0
        const retryIn = retryCount>10 ? 300 : 60;

        setTimeout(()=>{
            self.log.info(`Retrying to receive data from '${host.uris.state}'`)
            self.retires= self.retires.filter(u => u!==host.uris.state)
            self.getFromOutlet(callback, retryCount+1)
        }, retryIn*1000)
    }

    getFromOutlet(callback, retryCount){        
        
        const self = this;
        axios.get(this.host.uris.state)
            .then(function (response) {
                self.log.debug("getFromOutlet: ", response.data, response.status, response.statusText);
                if (response.status == 200) {
                    callback(null, response.data[0]);
                } else {                    
                    self.log.error(`Status ${response.status}: ${response.statusText}.`)
                    callback(`Status ${response.status}: ${response.statusText}`, null);
                    self.retryGetFromOutlet(self.host, callback, retryCount)                    
                }
                
            })
            .catch(function (error) {
                callback("Failed to Connect", null);
                self.log.error("getFromOutlet failed ", error.syscall, error.address, error.code);                
                self.retryGetFromOutlet(self.host, callback, retryCount)
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
                self.log.error("sendToOutlet failed ", error.syscall, error.address, error.code);
            });     
    }

    sendModeOutlet(callback){
        if (this.sendModeOutletTimer!==undefined){
            clearTimeout(this.sendModeOutletTimer.timeout);
            //this.sendModeOutletTimer.callback(null);
            this.sendModeOutletTimer = undefined;
            
        }

        this.sendModeOutletTimer = { 
            timeout: setTimeout(this._sendModeOutlet.bind(this, function(c){}), 100),
            callback: callback
        }
        callback(null);
    }

    _sendModeOutlet(callback){
        this.sendColorOutletTimer = undefined;
        const self = this;
        const mode = {
            mode:this.mode,
            speed: Math.max(0.01, ((this.speed/100)*this.maxSpeed))
        };
        self.log.debug("Sending Mode", mode);
        axios.post(this.host.uris.mode, qs.stringify(mode), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          })
            .then(function (response) {
                self.log.debug("sendModeOutlet: ", response.data, response.status, response.statusText);
                if (response.status == 200) {
                    callback(null);
                } else {
                    callback(`Status ${response.status}: ${response.statusText}`);
                }
                
            })
            .catch(function (error) {
                callback(error);
                self.log.error("sendModeOutlet: ", error);
            });      
    }

    sendColorOutlet(callback){
        if (this.sendColorOutletTimer!==undefined){
            clearTimeout(this.sendColorOutletTimer.timeout);
            //this.sendColorOutletTimer.callback(null);
            this.sendColorOutletTimer = undefined;
            
        }

        this.sendColorOutletTimer = { 
            timeout: setTimeout(this._sendColorOutlet.bind(this, function(c){}), 100),
            callback: callback
        }
        callback(null);
    }

    _sendColorOutlet(callback){
        this.sendColorOutletTimer = undefined;
        const self = this;
        const colors = {
            h:Math.round((this.hue / 360) * 0xFF),
            s:Math.round((this.saturation / 100) * 0xFF),
            v:Math.max(32, Math.round((this.brightness / 100) * 0xFF))
        };
        self.log.debug("Sending Colors", colors);
        axios.post(this.host.uris.color, qs.stringify(colors), {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          })
            .then(function (response) {
                self.log.debug("sendColorOutlet: ", response.data, response.status, response.statusText);
                if (response.status == 200) {
                    callback(null);
                } else {
                    callback(`Status ${response.status}: ${response.statusText}`);
                }
                
            })
            .catch(function (error) {
                callback(error);
                self.log.error("sendColorOutlet: ", error);
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
                //callback(error, this.On);
            } else {
                this.On = powerOn.on;
                this.log.debug("getOn :", this.On);
                
                //callback(null, this.On);
                this.updateOnState(this.On);
            }
        }.bind(this));
        if (this.On === null) {
            this.On = false;
        }
        callback(null, this.On);
    }

    setOn (value, callback) {
        if (value === undefined) {
            callback(null);
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
        this.getFromOutlet(function (error, json) {
            if (error) {
                //callback(error, this.mode);
            } else {
                this.mode = json.mode;
                this.log.debug("getMode :", this.mode);
                //callback(null, this.mode);
                this.updateMode(this.mode);
            }
        }.bind(this)); 
        callback(null, this.mode);       
    }

    setMode(val, callback){
        this.log.debug("setMode from/to", this.mode, val);
        let self = this;
        this.mode = val;
        if (val>=0 && val<self.modes.length) {                        
            this.service.getCharacteristic(CustomTypes.LightModeLabel).updateValue(this.modes[val]);
        } else {
            this.service.getCharacteristic(CustomTypes.LightModeLabel).updateValue(0);
        }

        this.sendModeOutlet(callback); 
    }



    getSpeed (callback) {
        this.getFromOutlet(function (error, json) {
            if (error) {
                //callback(error, this.speed);
            } else {
                this.speed = Math.round((json.speed / this.maxSpeed) * 100);
                this.log.debug("getSpeed :", this.speed);
                //callback(null, this.speed);
                this.updateSpeed(this.speed)
            }
        }.bind(this));        
        callback(null, this.speed);
    }

    setSpeed(val, callback){        
        this.log.debug("setSpeed from/to", this.speed, val);
        this.speed = val;        
        
        this.sendModeOutlet(callback); 
    }

    getModeLabel(callback){
        this.getMode( function(error, val) {
            if (val>=0 && val<this.modes.length) {
                callback(null, this.modes[val]);
            } else {
                callback("Invalid Mode", 0);
            }
        }.bind(this));
        this.log.debug("getModeLabel");        
    }

    getBrightness(callback){
        this.getFromOutlet(function (error, json) {
            if (error) {
                //callback(error, this.brightness);            
            } else {
                this.brightness = Math.round((json.v / 0xFF) * 100);
                this.log.debug("getBrightness :", this.brightness);
                //callback(null, this.brightness);
                this.updateBrightness(this.brightness)
            }
        }.bind(this));                 
        callback(null, this.brightness);
    }

    setBrightness(value, callback){
        this.log.debug("setBrightness from/to:", this.brightness, value);        
        this.brightness = value;
        this.sendColorOutlet(callback);
    }

    getHue(callback){
        this.getFromOutlet(function (error, json) {
            if (error) {
                //callback(error, this.hue);                
            } else {
                this.hue = Math.round((json.h / 0xFF) * 360);
                this.log.debug("getHue :", this.hue);
                //callback(null, this.hue);
                this.updateHue(this.hue)
            }
        }.bind(this)); 
        callback(null, this.hue);                 
    }

    setHue(value, callback){
        this.log.debug("setHue from/to:", this.hue, value);        
        this.hue = value;
        this.sendColorOutlet(callback);
    }

    getSaturation(callback){
        this.getFromOutlet(function (error, json) {
            if (error) {
                //callback(error, this.saturation);                
            } else {
                this.saturation = Math.round((json.s / 0xFF) * 100);
                this.log.debug("getSaturation :", this.saturation);
                //callback(null, this.saturation);
                this.updateSaturation(this.saturation)
            }
        }.bind(this));    
        callback(null, this.saturation);          
    }

    setSaturation(value, callback){
        this.log.debug("setSaturation from/to:", this.saturation, value);        
        this.saturation = value;
        this.sendColorOutlet(callback);
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
            let lightModeC = this.service.getCharacteristic(CustomTypes.LightMode);
            let lightModeLabelC = this.service.getCharacteristic(CustomTypes.LightModeLabel);
            let lightModeSpeed  = this.service.getCharacteristic(Characteristic.RotationSpeed);
            if (this.modes.length>0){
                if (lightModeC === undefined) lightModeC = this.service.addCharacteristic(CustomTypes.LightMode);
                if (lightModeLabelC === undefined) lightModeLabelC = this.service.addCharacteristic(CustomTypes.LightModeLabel);  
                if (lightModeSpeed === undefined) lightModeSpeed = this.service.addCharacteristic(Characteristic.RotationSpeed);  
                
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

                lightModeSpeed
                    .on('get', this.getSpeed.bind(this))
                    .on('set', this.setSpeed.bind(this));
            } else {
                if (lightModeC !== undefined) this.service.removeCharacteristic(CustomTypes.LightMode);
                if (lightModeLabelC !== undefined) this.service.removeCharacteristic(CustomTypes.LightModeLabel);
                if (lightModeSpeed !== undefined) this.service.removeCharacteristic(Characteristic.RotationSpeed);
            }

            this.service.getCharacteristic(Characteristic.Brightness)
                    .on('get', this.getBrightness.bind(this))
                    .on('set', this.setBrightness.bind(this));

            this.service.getCharacteristic(Characteristic.Hue)
                    .on('get', this.getHue.bind(this))
                    .on('set', this.setHue.bind(this));

            this.service.getCharacteristic(Characteristic.Saturation)
                    .on('get', this.getSaturation.bind(this))
                    .on('set', this.setSaturation.bind(this));
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