'use strict';
const suncalc = require('suncalc'),
      moment = require('moment'),
      columnify = require('columnify'),
      packageJSON = require("./package.json");
var Accessory, Service, Characteristic, UUIDGen;

const constantSolarRadiation = 1361 //Solar Constant W/m²
const arbitraryTwilightLux = 6.32     // W/m² egal 800 Lux
const TriggerTypes = Object.freeze({"event":1, "time":2, "altitude":3, "lux":4});
const TriggerWhen = Object.freeze({"greater":1, "less":-1, "both":0});
const EventTypes = Object.freeze({"nightEnd":1, "nauticalDawn":2, "dawn":3, "sunrise":4, "sunriseEnd":5, "goldenHourEnd":6, "solarNoon":7, "goldenHour":8, "sunsetStart":9, "sunset":10, "dusk":11, "nauticalDusk":12, "night":13, "nadir":14});

module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    console.logEvents = function(events){
        if (events === undefined) return;
        const NOW = new Date();
        let printData = [];
        events.forEach(function(event){            
            printData.push({
                event: event.event,
                when: moment(event.when).fromNow(),
                time: moment(event.when).format('HH:mm:ss'),
                day: moment(event.when).format('ll'), 
                dif:Math.round((event.when - NOW) / (1000 * 60)),
                lux:event.lux,
                altitude:event.pos.altitude * 180.0 / Math.PI 
            })
        });
        console.log(columnify(printData, {minWidth:15}));
    }

    function justTime(date){
        const m = moment(date);
        return moment({h: m.hours(), m: m.minutes(), s: m.seconds()});        
    }

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    class DaylightSensors {
        constructor(log, config) {
          if (!config.location ||
              !Number.isFinite(config.location.latitude) ||
              !Number.isFinite(config.location.longitude)) {
            throw new Error('Daylight Sensors need a location to work properly');
          }
    
          this.log = log;
          this.debug = config.debug || false;
          this.config = config;
          this.isActive = false;
          this.currentLux = false;
          this.timeout = this.config.tickTimer ? this.config.tickTimer : 30000;

          //Info about this plugin
          this.informationService = new Service.AccessoryInformation();    
          this.informationService
              .setCharacteristic(Characteristic.Manufacturer, "Ambertation")
              .setCharacteristic(Characteristic.Model, "Daylight Sensor")
              .setCharacteristic(Characteristic.SerialNumber, "0000")
              .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);
                    

          //we shall expose a lux Service?          
          this.luxService = new Service.LightSensor(this.config.name);
          this.luxService
              .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
              .on('get', callback => callback(null, this.currentLux));

          this.luxService
            .getCharacteristic(Characteristic.StatusActive)
            .on('get', callback => callback(null, this.isActive));

          this.parseTrigger(config.trigger);

          //get the current event state as well as all future events
          let allEvents = this.eventsForDate(new Date(), false);
          this.events = [];
          this.currentEvent = allEvents[0];
          const NOW = new Date();
          allEvents.forEach(event => {
            if (event.when - NOW < 0) {
                this.currentEvent = event;
            } else {
                this.events.push(event);
            }
          });

          this.queueNextEvent();
        }

        getServices() { 
            let services = [this.informationService, this.luxService];
            return services; 
        }

        parseTrigger(trigger){
            this.triggers = []
            let ID = 0;
            trigger.forEach(val => {
                const type = TriggerTypes[val.type];
                let value = '';
                ID++;
                switch(type){
                    case TriggerTypes.event:
                        value = EventTypes[val.value];
                    break;
                    case TriggerTypes.time:
                        value = moment(val.value, ['h:m a', 'H:m']).toDate();
                    break;
                    case TriggerTypes.altitude:
                        value = (val.value / 180.0) * Math.PI;
                        //suncalc.addTime(val.value, ID+'_AM', ID+'_PM');
                    break;
                    case TriggerTypes.lux:
                        value = Math.round(val.value);
                    break;
                    default:
                        return;
                }
                
                this.triggers.push({
                    type: type,
                    active: val.active !== undefined ? val.active : true,
                    value: value,
                    id:ID,
                    when: TriggerWhen[val.trigger ? val.trigger : 'greater']
                });
            });
            console.log(this.triggers);
        }

        luxForTime(when, pos){
            const numOfDay = moment(when).dayOfYear();
            const nbDaysInYear = 365;
            const RadiationAtm = constantSolarRadiation * (1 +0.034 * Math.cos((Math.PI / 180) * numOfDay / nbDaysInYear ));    // Sun radiation  (in W/m²) in the entrance of atmosphere.
            if (pos === undefined) {
                pos = this.posForTime(when);
            }
            const sinusSunAltitude = Math.sin(pos.altitude);
            const altitude = 300;
            const relativePressure = 1100;
            const absolutePressure = relativePressure - Math.round((altitude/ 8.3),1) // hPa
            const M0 = Math.sqrt(1229 + Math.pow(614 * sinusSunAltitude,2)) - 614 * sinusSunAltitude
            const M = M0 * relativePressure/absolutePressure
            if (pos.altitude > Math.PI/180) {
                const directRadiation = RadiationAtm * Math.pow(0.6,M) * sinusSunAltitude;
                const scatteredRadiation = RadiationAtm * (0.271 - 0.294 * Math.pow(0.6,M)) * sinusSunAltitude;
                const totalRadiation = scatteredRadiation + directRadiation;
                const Lux = totalRadiation / 0.0079  //Radiation in Lux. 1 Lux = 0,0079 W/m²            
                return Lux;
            } else if (pos.altitude <= Math.PI/180 && pos.altitude >= -7*Math.PI/180) {
                const directRadiation = 0
                const scatteredRadiation = 0
                const arbitraryTwilight=arbitraryTwilightLux-(1-pos.altitude)/8*arbitraryTwilightLux
                const totalRadiation = scatteredRadiation + directRadiation + arbitraryTwilight
                const Lux = totalRadiation / 0.0079  // Radiation in Lux. 1 Lux = 0,0079 W/m²          
                return Lux;
            } else {
                return 0;
            }
        }

        eventsForDate(when, commingOnly){
            if (commingOnly === undefined) commingOnly = true;
            const times = suncalc.getTimes(when, this.config.location.latitude, this.config.location.longitude);
            const NOW = new Date();
            let events = [];
        
            for (var property in times) {
                if (times.hasOwnProperty(property)) {
                    const time = times[property];
                    const delta = time-NOW;
                    if (delta>=0 || !commingOnly) {
                        const pos = this.posForTime(time);
                        
                        events.push({
                            event: property,
                            when: time,
                            lux: this.luxForTime(time, pos),
                            pos: pos
                        });
                    }
                }
            }
            events.sort(function(a, b) { return a.when - b.when; });
            return events;
        }

        posForTime(when){
            return suncalc.getPosition(when, this.config.location.latitude, this.config.location.longitude);
        }

        queueNextEvent() {
            if (!this.events){
                this.events = this.eventsForDate(new Date());
            }

            if (this.events.length<=1) {
                const newEvents = this.eventsForDate(moment().add(1, 'day').toDate());
                const merged = this.events.concat(newEvents);
                this.events = merged;
            }

            setTimeout(this.updateState.bind(this, undefined), this.timeout);
        }

        updateState(when) {
            if (when === undefined) when = new Date();

            const pos = this.posForTime(when);
            const newLux = this.luxForTime(when, pos);

            function changeByTrigger(trigger, what){
                if (what && (trigger.when == TriggerWhen.greater || trigger.when == TriggerWhen.both)) {
                    result = trigger.active;
                    console.log("Trigger changed result   -- ", result, trigger);
                } else if (!what && (trigger.when == TriggerWhen.less || trigger.when == TriggerWhen.both)) {
                    result = !trigger.active;
                    console.log("Trigger changed result   -- ", result, trigger);
                }
            }
                       
            let result = this.config.dayStartsActive ? this.config.dayStartsActive : false;               
            console.log("Starting day with result -- ", result);         
            
            this.triggers.forEach(trigger => {
                switch(trigger.type) {
                    case TriggerTypes.time:                    
                        changeByTrigger(trigger, justTime(when) > justTime(trigger.value));
                    break;
                    case TriggerTypes.event:
                        changeByTrigger(trigger, EventTypes[this.currentEvent.event] == trigger.value);
                    break;
                    case TriggerTypes.altitude:
                        changeByTrigger(trigger, pos.altitude > trigger.value );
                    break;
                    case TriggerTypes.lux:
                        changeByTrigger(trigger, newLux > trigger.value );
                    break;
                    default:

                }
            })

            if (Math.abs(this.currentLux != newLux)>1){
                this.currentLux = Math.round(newLux);
                this.luxService.setCharacteristic(
                    Characteristic.CurrentAmbientLightLevel,
                    this.currentLux
                );            
            }
            
            if (this.isActive != result) {
                this.isActive = result;
                this.luxService.setCharacteristic(
                    Characteristic.StatusActive,
                    this.isActive
                );
            }

            console.log("State at" + when, this.isActive, this.currentLux);
            this.queueNextEvent();
        }
    }
    
    // For platform plugin to be considered as dynamic platform plugin,
    // registerPlatform(pluginName, platformName, constructor, dynamic), dynamic must be true
    homebridge.registerPlatform("homebridge-daylight-sensors", "DaylightSensors", DaylightSensors, true);


};