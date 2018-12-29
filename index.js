'use strict';
const suncalc = require('suncalc'),
      moment = require('moment'),
      columnify = require('columnify'),
      packageJSON = require("./package.json"),
      express = require('express'),
      path = require('path'),
      fs = require('fs');
      
moment.locale('de');
var Service, Characteristic, Accessory, UUIDGen;

const constantSolarRadiation = 1361 //Solar Constant W/m²
const arbitraryTwilightLux = 6.32     // W/m² egal 800 Lux
const TriggerTypes = Object.freeze({"event":1, "time":2, "altitude":3, "lux":4});
const TriggerWhen = Object.freeze({"greater":1, "less":-1, "both":0});
const EventTypes = Object.freeze({"nightEnd":1, "nauticalDawn":2, "dawn":3, "sunrise":4, "sunriseEnd":5, "goldenHourEnd":6, "solarNoon":7, "goldenHour":8, "sunsetStart":9, "sunset":10, "dusk":11, "nauticalDusk":12, "night":13, "nadir":14});

function triggerEventName(type){
    switch(type){
        case EventTypes.nightEnd:
            return 'Night End'; 
        case EventTypes.nauticalDawn:
            return 'Nautical Dawn'; 
        case EventTypes.dawn:
            return 'Dawn';  
        case EventTypes.sunrise:
            return 'Sunrise'; 
        case EventTypes.sunriseEnd:
            return 'Sunrise End'; 
        case EventTypes.goldenHourEnd:
            return 'Golden Hour End';
        case EventTypes.solarNoon:
            return 'Solar Noon'; 
        case EventTypes.goldenHour:
            return 'Golden Hour'; 
        case EventTypes.sunsetStart:
            return 'Sunset Start';  
        case EventTypes.sunset:
            return 'Sunset'; 
        case EventTypes.dusk:
            return 'Dusk'; 
        case EventTypes.nauticalDusk:
            return 'Nautical Dusk'; 
        case EventTypes.night:
            return 'Night'; 
        case EventTypes.nadir:
            return 'Lowest Sun';    
        default:
        return 'UNKNOWN';
    }
}

function triggerTypeName(type){
    switch(type){
        case TriggerTypes.event:
            return 'EVENT'; 
        case TriggerTypes.time:
            return 'Time'; 
        case TriggerTypes.altitude:
            return 'Altitude'; 
        case TriggerTypes.lux:
            return 'Lux'; 
        default:
        return 'UNKNOWN';
    }
}

function triggerWhenName(type){
    switch(type){
        case TriggerWhen.greater:
            return '>'; 
        case TriggerWhen.less:
            return '<'; 
        case TriggerWhen.both:
            return '< or >';         
        default:
        return '?';
    }
}

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

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerAccessory("homebridge-daylight-sensors", "DaylightSensors", DaylightSensors);
}

function justTime(date){
    const m = moment(date);
    return moment({h: m.hours(), m: m.minutes(), s: m.seconds()});        
}

function formatRadians(rad){
    return formatNumber((rad/Math.PI)*180)+'°';
}

function formatNumber(nr){
    return parseFloat(Math.round(nr * 100) / 100).toFixed(2)
}

class DaylightSensors {
    constructor(log, config, api) {
        if (!config.location ||
            !Number.isFinite(config.location.latitude) ||
            !Number.isFinite(config.location.longitude)) {
        throw new Error('Daylight Sensors need a location to work properly');
        }

        const self = this;
        
        this.log = log;
        this.debug = config.debug || false;
        this.config = config;
        this.isActive = false;
        this.currentLux = false;
        this.timeout = this.config.tickTimer ? this.config.tickTimer : 30000;
        this.luxService = undefined;                

        this.parseTrigger(config.trigger);

        this.log("loading Events");
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

        this.activeDay = undefined;

        //we shall expose a lux Service?          
        //this.luxService = new Service.LightSensor();
        this.switchService = new Service.StatelessProgrammableSwitch();
        this.luxService = this.switchService
        this.switchService.addCharacteristic(Characteristic.On);
        this.switchService.addCharacteristic(Characteristic.CurrentAmbientLightLevel);

        if (api) {
            // Save the API object as plugin needs to register new accessory via this object
            this.api = api;
        
            // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
            // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
            // Or start discover new accessories.
            this.api.on('didFinishLaunching', function() {
                self.log("DidFinishLaunching");
            }.bind(this));
        }

        this.log("Updating Initial State");
        this.updateState();

        if (this.config.port > 0) {
            const port = this.config.port;
            console.log(`Starting HTTP listener on port ${port}...`);
            var expressApp = express();
            expressApp.listen(port, (err) =>
            {
                if (err) {
                    console.error(`Failed to start Express on port ${port}!`, err);
                } else {
                    this.log(`Express is running on port ${port}.`)
                }
            });

            
            expressApp.get("/0", (request, response) => {
                this.isActive = true;
                this.syncSwitchState();           
                response.send('Switch triggered 0.');
                console.log("ON");
            });
            expressApp.get("/1", (request, response) => {
                this.isActive = false;
                this.syncSwitchState();          
                response.send('Switch triggered 1.');
                console.log("OFF");
            });
            expressApp.get("/", (request, response) => {               
                response.send(this.buildInfoHTML());               
            }); 
            expressApp.get("/js/d3.js", (request, response) => {               
                response.sendFile(path.join(__dirname, './js/d3.v5.min.js'));           
            }); 
            expressApp.get("/css/bootstrap.min.css", (request, response) => {               
                response.sendFile(path.join(__dirname, './css/bootstrap.min.css'));           
            }); 
            expressApp.get("/css/bootstrap.min.css.map", (request, response) => {               
                response.sendFile(path.join(__dirname, './css/bootstrap.min.css.map'));           
            });  
            this.log("HTTP listener started.");
        }
        
        this.log("finished Initialization");
    }

    getServices() { 
        const when = new Date();
        const pos = this.posForTime(when);
        const newLux = this.luxForTime(when, pos);
        this.currentLux = Math.round(newLux);
        console.log("INIT LUX", this.currentLux, when, pos, newLux);

        //Info about this plugin
        let informationService = new Service.AccessoryInformation ()
            .setCharacteristic(Characteristic.Manufacturer, "Ambertation")
            .setCharacteristic(Characteristic.Model, "Daylight Sensor")
            .setCharacteristic(Characteristic.SerialNumber, "0000")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

        const self = this;
        this.luxService
            .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
            .on('get', callback => callback(null, self.currentLux));
        
        
        this.luxService.setCharacteristic(
            Characteristic.CurrentAmbientLightLevel,
            this.currentLux
        ); 

        this.switchService
            .getCharacteristic(Characteristic.On)
            .on('get', callback => callback(null, self.isActive));

        this.switchService
            .getCharacteristic(Characteristic.On)
            .setProps({ perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY] });            

        this.switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setProps({ maxValue: 1 });

        this.switchService
            .getCharacteristic(Characteristic.ServiceLabelIndex)
            .setValue(0);

        this.syncSwitchState();
        
        return [informationService, this.switchService];        
    }

    identify(callback) {
        this.log('Identify requested!');
        callback(null);
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
        this.log(this.triggers);
    }

    //https://web.archive.org/web/20170819110438/http://www.domoticz.com:80/wiki/Real-time_solar_data_without_any_hardware_sensor_:_azimuth,_Altitude,_Lux_sensor...
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

    fetchEventAt(when){
        var result = undefined;
        this.events.forEach(event => {
            if (event.when - when < 0) {
                result = event;
            } 
        });

        return result;
    }

    fetchEvents(when) {
        var e1 = this.eventsForDate(when, false);
        var e2 = this.eventsForDate(moment().add(1, 'day').toDate(), false);
        var e0 = this.eventsForDate(moment().add(-1, 'day').toDate(), false);

        this.events = e0.concat(e1).concat(e2);
        console.log(moment(when).format('LTS'));
        this.events.forEach(event => {
            console.log(moment(event.when).format('LTS'), event.event, formatRadians(event.pos.altitude), Math.round(event.lux));
        });
    }

    queueNextEvent() {
        const now = moment();
        const day = moment({h: 0, m: 0, s: 1});
        var days = this.activeDay ?  Math.abs(moment.duration(day.diff(this.activeDay)).asDays()) : 1;
        console.log("Curent Event: ", this.fetchEventAt(now.toDate()), "days passed", days);
        if (days >= 0.98) {
            const when = now.toDate();
            this.activeDay = day;
            this.fetchEvents(when);
        }

        setTimeout(this.updateState.bind(this, undefined), this.timeout);
    }

    testIfActive(when) {
        const pos = this.posForTime(when);
        const newLux = this.luxForTime(when, pos);
        let obj = {
            active:false,
            pos:pos,
            lux:newLux,
            conditions:[]
        };
        
        const self = this;
        let result = this.config.dayStartsActive ? this.config.dayStartsActive : false;               
        this.log("Starting day with result   -- " + result);    

        function changeByTrigger(trigger, what){
            if (what && (trigger.when == TriggerWhen.greater || trigger.when == TriggerWhen.both)) {
                obj.conditions.push({trigger:trigger, active:trigger.active});
                result = trigger.active;
                self.log("    Trigger changed result -- " + self.formatTrigger(trigger) + " => " + result);
            } else if (!what && (trigger.when == TriggerWhen.less || trigger.when == TriggerWhen.both)) {
                obj.conditions.push({trigger:trigger, active:!trigger.active});
                result = !trigger.active;
                self.log("    Trigger changed result -- " + self.formatTrigger(trigger) + " => " + result);
            }
        }                                
        
        this.triggers.forEach(trigger => {
            switch(trigger.type) {
                case TriggerTypes.time:                    
                    changeByTrigger(trigger, justTime(when) > justTime(trigger.value));
                break;
                case TriggerTypes.event:
                    const event = this.fetchEventAt(when);
                    if (event) {
                        changeByTrigger(trigger, EventTypes[event.event] == trigger.value);
                    }
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

        obj.active = result;
        return obj;
    }

    updateState(when) {
        if (when === undefined) when = new Date();

        const obj = this.testIfActive(when);
        const pos = obj.pos;
        const newLux = obj.lux;
        const result = obj.active;
        
        const self = this;               
        
        if (this.luxService && Math.abs(this.currentLux - newLux)>1){
            this.currentLux = Math.round(newLux);
            console.log("setCharacteristic", this.currentLux)
            this.luxService.setCharacteristic(
                Characteristic.CurrentAmbientLightLevel,
                this.currentLux
            );            
        }    
        
        if (this.isActive != result) {
            this.isActive = result;
            this.syncSwitchState();
        }

        this.log("    State at " + moment(when).format('LTS'), this.isActive, this.currentLux);
        this.queueNextEvent();
    }

    syncSwitchState(){
        this.switchService.setCharacteristic(
            Characteristic.On,
            this.isActive
        );
        this.switchService
                .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
                .setValue(this.isActive  ? Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS : Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS)
    }

    formatTrigger(trigger){
        let s = ''
        s += triggerTypeName(trigger.type) + ' ';
        s += triggerWhenName(trigger.when) + ' ';
        switch(trigger.type){
            case TriggerTypes.time:
                s += moment(trigger.value).format("LTS");
                break;
            case TriggerTypes.event:
                s += triggerEventName(trigger.value);
                break;
            case TriggerTypes.altitude:
                s += formatRadians(trigger.value);
                break;
            case TriggerTypes.lux:
                s += Math.round(trigger.value);
                break;
            default:
                s += trigger.value;
        }
        s += ' (' + trigger.active + ')';
        return s;
    }

    buildInfoHTML(){
        const start = moment({h: 0, m: 0, s: 1})
        let offset = 0;
        let p = 0;
        let data = [
            {data:[], min:-1, max:+1, name:'active', blocky:true},
            {data:[], min:-90, max:90, name:'altitude', blocky:false},
            {data:[], min:0, max:100000, name:'lux', blocky:false}];

        let tableHTML = '';        
        while (offset < 60*24) {
            const mom = start.add(1, 'minutes');            
            const when = mom.toDate();
            const obj = this.testIfActive(when);
            console.log(when, obj.active);

            data[0].data[p] = {
                date : mom.toDate(),
                value : obj.active ? 1 : 0,
                time : mom.format('LT'),
                values : [obj.active ? 0 : -1, obj.active ? 0 : 1]
            }; 
            data[1].data[p] = {
                date : mom.toDate(),
                value : 180*obj.pos.altitude/Math.PI,
                time : mom.format('LT'),
                values : [Math.min(180*obj.pos.altitude/Math.PI, 0), Math.max(180*obj.pos.altitude/Math.PI, 0)]
            };
            data[2].data[p] = {
                date : mom.toDate(),
                value : obj.lux,
                time : mom.format('LT'),
                values : [Math.min(obj.lux, 0), Math.max(obj.lux, 0)]
            };            
            offset += 1;
            p++;

            const e = this.fetchEventAt(when);
            const et = triggerEventName(e ? EventTypes[e.event] : -1);
            tableHTML += '<tr><th colspan="3">';
            tableHTML += mom.format('LT')+', ';
            tableHTML += formatRadians(obj.pos.altitude)+', ';
            tableHTML += Math.round(obj.lux) +', ';
            tableHTML += et + '</th></tr>';
            obj.conditions.forEach(val => {
                tableHTML += '<tr><td></td><td>';
                tableHTML += this.formatTrigger(val.trigger);
                tableHTML +='</td><td> =&gt; '+(val.active?'yes':'no')+'</td></tr>';
            })
        }
        
        let s = fs.readFileSync(path.join(__dirname, './template.html'), { encoding: 'utf8' });

        s = s.replace('\{\{DATA\}\}', JSON.stringify(data));
        s = s.replace('\{\{TABLE\}\}', tableHTML);
        return s;
    }
}
