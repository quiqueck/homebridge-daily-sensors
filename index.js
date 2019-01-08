'use strict';
const suncalc = require('suncalc'),
      moment = require('moment'),
      columnify = require('columnify'),
      packageJSON = require("./package.json"),
      express = require('express'),
      path = require('path'),
      fs = require('fs'),
      ical = require('./lib/iCal.js');

var Service, Characteristic, Accessory, UUIDGen;
var WebServers = {};
var WebPaths = {};
const constantSolarRadiation = 1361 //Solar Constant W/m²
const arbitraryTwilightLux = 6.32     // W/m² egal 800 Lux
const TriggerTypes = Object.freeze({"event":1, "time":2, "altitude":3, "lux":4, "calendar":5});
const TriggerWhen = Object.freeze({"greater":1, "less":-1, "both":0});
const TriggerOps = Object.freeze({"set":0, "and":1, "or":2, 'discard':3});
const EventTypes = Object.freeze({"nightEnd":1, "nauticalDawn":2, "dawn":3, "sunrise":4, "sunriseEnd":5, "goldenHourEnd":6, "solarNoon":7, "goldenHour":8, "sunsetStart":9, "sunset":10, "dusk":11, "nauticalDusk":12, "night":13, "nadir":14});

function triggerOpsName(type){
    switch(type){
        case TriggerOps.set:
            return ''; 
        case TriggerOps.and:
            return '[AND]'; 
        case TriggerOps.or:
            return '[OR]';  
        case TriggerOps.discard:
            return '[DROP]'; 
        default:
        return '[?]';
    }
}

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

function triggerTypeName(type, withOp){
    if (withOp === undefined) withOp = false;
    var ret = ''
    switch(type){
        case TriggerTypes.event:
            ret = 'EVENT'; 
            if (withOp) ret += ' =';
            break;
        case TriggerTypes.time:
            ret = 'Time'; 
            if (withOp) ret += ' >';
            break;
        case TriggerTypes.altitude:
            ret = 'Altitude'; 
            if (withOp) ret += ' >';
            break;
        case TriggerTypes.lux:
            ret = 'Lux'; 
            if (withOp) ret += ' >';
            break;
        case TriggerTypes.calendar:
            ret = 'Calendar'; 
            if (withOp) ret += ' =';
            break;
        default:
            ret = 'UNKNOWN';
    }
    
    return ret;
}

function triggerWhenName(type){
    switch(type){
        case TriggerWhen.greater:
            return 'Trigger If'; 
        case TriggerWhen.less:
            return 'Trigger If Not'; 
        case TriggerWhen.both:
            return '';         
        default:
        return '?';
    }
}

function dayOfWeekNameList(mask){
    let s = ''
    for (var i = 1; i<=7; i++){
        if ((mask & (1<<(i-1))) != 0){
            s+= moment().isoWeekday(i).format('dd')+" "
        }
    }
    s = s.trim();
    if (s!=''){
        s = '(on ' + s + ')';
    }
    return s;
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

    homebridge.registerAccessory("homebridge-daily-sensors", "DailySensors", DailySensors);
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

class DailySensors {
    constructor(log, config, api) {
        if (!config.location ||
            !Number.isFinite(config.location.latitude) ||
            !Number.isFinite(config.location.longitude)) {
        throw new Error('Daylight Sensors need a location to work properly');
        }
        moment.locale(config.locale ? config.locale : 'en');

        const self = this;        
        this.log = log;        
        this.override = undefined;
        this.debug = config.debug || false;
        this.config = config;        
        this.port = this.config.port ? this.config.port : 0;
        this.webPath = path.resolve('/', './' + (this.config.webPath ? this.config.webPath : this.config.name.toLowerCase()) + '/'); 
        this.isActive = false;
        this.currentLux = false;
        this.timeout = this.config.tickTimer ? this.config.tickTimer : 30000;
        this.luxService = undefined;               

        this.parseTrigger(config.trigger);

        if (this.debug) this.log("loading Events");
        //get the current event state as well as all future events
        let allEvents = this.eventsForDate(new Date(), false);
        this.events = [];
        this.calendar = [];
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

        this.log("Updating Initial State for " + this.config.name);
        this.updateState();

        if (this.port > 0) {
            const port = this.port;
            if (this.debug) this.log(`Starting HTTP listener on port ${port} for path ${this.webPath}...`);

            var expressApp = WebServers[this.port];
            var masterForPort = false;
            if (expressApp === undefined) {
                masterForPort = true;
                expressApp = express();
                expressApp.listen(port, (err) =>
                {
                    if (err) {
                        console.error(`Failed to start Express on port ${port}!`, err);
                    } else {
                        if (this.debug) this.log(`Express is running on port ${port}.`)
                    }
                });

                WebServers[this.port] = expressApp;
            }

            //get list of available paths on a port
            var paths = WebPaths[this.port];
            if (paths === undefined){
                paths = [];
                WebPaths[this.port] = paths;
            }
            paths.push({
                path:this.webPath,
                name:this.config.name
            })

            
            expressApp.get(this.webPath+"/0", (request, response) => {
                this.override = false;
                this.syncSwitchState();           
                response.send('Switch forced to trigger OFF.\n');
                if (this.debug) this.log("received OFF");
            });
            expressApp.get(this.webPath+"/1", (request, response) => {
                this.override = true;
                this.syncSwitchState();          
                response.send('Switch forced to trigger ON.\n');
                if (this.debug) this.log("received ON");
            });
            expressApp.get(this.webPath+"/clear", (request, response) => {
                this.override = undefined;
                this.syncSwitchState();          
                response.send('Switch operation normal.\n');
                if (this.debug) this.log("received CLEAR");
            });
            expressApp.get(this.webPath+"/state", (request, response) => {
                response.send('Switch is ' + (this.getIsActive()?'ON':'OFF') + '\nOverride is ' + (this.override===undefined?'INACTIVE':'ACTIVE') + '\n');
                if (this.debug) this.log("received STATE");
            });
            expressApp.get(this.webPath+"/", (request, response) => {               
                response.send(this.buildInfoHTML());               
            }); 

            if (masterForPort) {
                expressApp.get("/js/d3.js", (request, response) => {               
                    response.sendFile(path.join(__dirname, './js/d3.v5.min.js'));           
                }); 
                expressApp.get("/css/bootstrap.min.css", (request, response) => {               
                    response.sendFile(path.join(__dirname, './css/bootstrap.min.css'));           
                }); 
                expressApp.get("/css/bootstrap.min.css.map", (request, response) => {               
                    response.sendFile(path.join(__dirname, './css/bootstrap.min.css.map'));           
                }); 
                expressApp.get("/", (request, response) => {               
                    response.send(this.buildIndexHTML());           
                });  
            }
            this.log("HTTP listener started on port " + port + "  for path " + this.webPath + ".");
        }
        
        this.log("Finished Initialization");
    }

    getIsActive() {
        return (this.override!==undefined) ? this.override : this.isActive;
    }

    getServices() { 
        const when = new Date();
        const pos = this.posForTime(when);
        const newLux = this.luxForTime(when, pos);
        this.currentLux = Math.round(newLux);        

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
            .on('get', callback => callback(null, self.getIsActive()));

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
            const op = val.op !== undefined ? TriggerOps[val.op] : TriggerOps.set;
            let value = '';
            let random = val.random;
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
                    random = (val.random / 180.0) * Math.PI;
                    //suncalc.addTime(val.value, ID+'_AM', ID+'_PM');
                break;
                case TriggerTypes.lux:
                    value = Math.round(val.value);
                break;
                case TriggerTypes.calendar:
                    value = val.value; //regex
                break;
                default:
                    return;
            }

            let daysOfWeek = 0;
            if (val.daysOfWeek !== undefined){                
                val.daysOfWeek.forEach(v => {
                    let d = moment().isoWeekday(v).isoWeekday()-1;
                    let b = 1 << d;
                    daysOfWeek |= b;
                });
            }
            this.triggers.push({
                type: type,
                active: val.active !== undefined ? val.active : true,
                value: value,
                id:ID,
                when: TriggerWhen[val.trigger ? val.trigger : 'greater'],
                op:op,
                random: random,
                daysOfWeek: daysOfWeek
            });
        });
        if (this.debug) this.log(this.triggers);
    }

    luxForTime(when, pos){
        if (pos === undefined) {
            pos = this.posForTime(when);
        }
        const minRad = (-9.0 / 180) * Math.PI;
        var alt = pos.altitude;
        if (alt < minRad) return 0;

        alt -= minRad;
        alt /= (Math.PI/2 - minRad);
        alt *= Math.PI/2;
        

        //console.log(pos.altitude- alt, minRad, Math.sin(alt) * 100000);
        return Math.sin(alt) * 100000;
    }

    //https://web.archive.org/web/20170819110438/http://www.domoticz.com:80/wiki/Real-time_solar_data_without_any_hardware_sensor_:_azimuth,_Altitude,_Lux_sensor...
    luxForTime2(when, pos){
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
        this.calendar = [];
        if (this.config.calendar) {      
            ical.loadEventsForDay(moment(when), this.config.calendar, (list, start, end) => {
                if (this.debug){
                    console.log("New Calendar Events:\n", list.map(e => "  " + moment(e.startDate).format('LTS') + " - " + moment(e.endDate).format('LTS') + ": "+ e.summary).join("\n"));
                }
                this.calendar = list;
            });
        }

        var e1 = this.eventsForDate(when, false);
        var e2 = this.eventsForDate(moment().add(1, 'day').toDate(), false);
        var e0 = this.eventsForDate(moment().add(-1, 'day').toDate(), false);

        this.events = e0.concat(e1).concat(e2);
        if (this.debug) this.log(moment(when).format('LTS'));
        this.events.forEach(event => {
            if (this.debug) this.log(moment(event.when).format('LTS'), event.event, formatRadians(event.pos.altitude), Math.round(event.lux));
        });

        this.triggers.forEach(trigger => {
            let r = trigger.random ? trigger.random : 0;
            if (r==0){
                trigger.randomizedValue = trigger.value;
                return;
            }

            let rnd = Math.random() * 2*r - r;
            switch (trigger.type ) {
                case TriggerTypes.lux:
                case TriggerTypes.altitude:
                    trigger.randomizedValue = trigger.value + rnd;
                    break;
                case TriggerTypes.time:
                    let m = moment(trigger.value);
                    m = m.add(rnd, 'minutes');
                    trigger.randomizedValue = m.toDate();
                    break;
                default:
                    trigger.randomizedValue = trigger.value
            }
            if (this.debug) {
                this.log("generated", trigger.randomizedValue, "from", trigger.value, "+", trigger.random, rnd)
            }
        });
    }

    matchesCalEventNow(when, regex) {
        const r = new RegExp(regex);
        
        const events = ical.eventsAt(moment(when), this.calendar).filter(e => e.summary.match(r)!==null);
        if (this.debug){
            console.log("Matching Events for '" + regex + "' at "+ moment(when).format('LTS') +":\n", events.map(e => "  " + moment(e.startDate).format('LTS') + " - " + moment(e.endDate).format('LTS') + ": "+ e.summary).join("\n"));            
        }
        return events.length > 0;
    }

    queueNextEvent() {
        const now = moment();
        const day = moment({h: 0, m: 0, s: 1});
        var days = this.activeDay ?  Math.abs(moment.duration(day.diff(this.activeDay)).asDays()) : 1;
        if (this.debug) this.log("Curent Event: ", this.fetchEventAt(now.toDate()), "days passed", days);
        if (days >= 0.98) {
            const when = now.toDate();
            this.activeDay = day;
            this.fetchEvents(when);
        }

        setTimeout(this.updateState.bind(this, undefined), this.timeout);
    }

    testTrigger(trigger, when, obj, result, single, silent) {
        const self = this;

        if (trigger.daysOfWeek != 0) {
            const dow = 1 << (moment(when).isoWeekday() - 1);
            if ((trigger.daysOfWeek & dow) == 0) {
                return result;
            }
        }

        function concat(r) {
            if (single) {
                result = r;
                return;
            }
            switch(trigger.op){
                case TriggerOps.and:
                    result = result && r;
                    break;
                case TriggerOps.or:
                    result = result || r;
                    break;
                case TriggerOps.discard:
                    break;
                default:
                    result = r;
            }
        }

        function changeByTrigger(trigger, what){
            if (what && (trigger.when == TriggerWhen.greater || trigger.when == TriggerWhen.both)) {
                
                concat(trigger.active);
                if (!silent) obj.conditions.push({trigger:trigger, active:trigger.active, result:result});
                if (!silent && self.debug) self.log("    Trigger changed result -- " + self.formatTrigger(trigger) + " => " + result);
            } else if (!what && (trigger.when == TriggerWhen.less || trigger.when == TriggerWhen.both)) {
                concat(!trigger.active);
                if (!silent) obj.conditions.push({trigger:trigger, active:!trigger.active, result:result});    
                if (!silent && self.debug) self.log("    Trigger changed result -- " + self.formatTrigger(trigger) + " => " + result);
            }
        } 

        switch(trigger.type) {
            case TriggerTypes.time:                    
                changeByTrigger(trigger, justTime(when) > justTime(trigger.randomizedValue));
            break;
            case TriggerTypes.event:
                const event = this.fetchEventAt(when);
                if (event) {
                    changeByTrigger(trigger, EventTypes[event.event] == trigger.value);
                }
            break;
            case TriggerTypes.altitude:
                changeByTrigger(trigger, obj.pos.altitude > trigger.randomizedValue );
            break;
            case TriggerTypes.lux:
                changeByTrigger(trigger, obj.lux > trigger.randomizedValue );
            break;
            case TriggerTypes.calendar:
                changeByTrigger(trigger, this.matchesCalEventNow(when, trigger.value) );
            break;
            default:

        }

        return result;
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
        if (this.debug) this.log("Starting day with result   -- " + result);    
        this.triggers.forEach(trigger => result = self.testTrigger(trigger, when, obj, result, false, false));

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
            this.luxService.setCharacteristic(
                Characteristic.CurrentAmbientLightLevel,
                this.currentLux
            );            
        }    
        
        if (this.isActive != result) {
            this.override = undefined;
            this.isActive = result;
            this.syncSwitchState();
        }

        if (this.debug) this.log("    State at " + moment(when).format('LTS'), this.isActive, this.currentLux);
        this.queueNextEvent();
    }

    syncSwitchState(){
        this.switchService.setCharacteristic(
            Characteristic.On,
            this.getIsActive()
        );

        this.switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setValue(this.getIsActive() ? Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS : Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS);
    }

    formatTrigger(trigger){
        let s = ''
        s += triggerOpsName(trigger.op) + ' '
        s = (s + dayOfWeekNameList(trigger.daysOfWeek)).trim() + ' ';
        s = (s + triggerWhenName(trigger.when)).trim() + ' ';
        s = (s + triggerTypeName(trigger.type, true)).trim() + ' ';
        
        switch(trigger.type){
            case TriggerTypes.time:
                if (trigger.random && trigger.random!=0) {
                    s += moment(trigger.randomizedValue).format("LTS");
                    s+= ' (' + moment(trigger.value).format("LTS") + '±' + trigger.random + " min.)";
                } else {
                    s += moment(trigger.value).format("LTS");
                }
                
                break;
            case TriggerTypes.event:
                s += triggerEventName(trigger.value);
                break;
            case TriggerTypes.altitude:                
                if (trigger.random && trigger.random!=0) {
                    s += formatRadians(trigger.randomizedValue);
                    s+= ' (' +formatRadians(trigger.value)+ '±' + formatRadians(trigger.random) + ")";
                } else {
                    s += formatRadians(trigger.value);
                }
                break;
            case TriggerTypes.lux:                
                if (trigger.random && trigger.random!=0) {
                    s += Math.round(trigger.randomizedValue);
                    s+= ' (' + Math.round(trigger.value) + '±' + trigger.random + ")";
                } else {
                    s += Math.round(trigger.value);
                }
                break;
            case TriggerTypes.calendar:                
                s += trigger.value;                
                break;
            default:
                s += trigger.value;
        }
        s += ' (' + trigger.active + ')';
        return s;
    }

    buildIndexHTML(){
        let linksHTML = '';
        WebPaths[this.port].forEach(p => {
            linksHTML += '<li><a href="'+p.path+'">'+p.name+'</a></li>';
        })
        let s = fs.readFileSync(path.join(__dirname, './index.html'), { encoding: 'utf8' });

        s = s.replace('\{\{LINKS\}\}', linksHTML);
        return s;
    }

    buildInfoHTML(){
        function formatState(state, bold){
            if (bold===undefined) bold=true;
            let s = '<'+(bold?'b':'span')+' style="color:'+(state?'green':'red')+'">';
            s += (state?'ON':'OFF');
            s += '</'+(bold?'b':'span')+'>';
            return s;
        }
        const start = moment({h: 0, m: 0, s: 1})

        const minutes = 1;
        let offset = 0;
        let p = 0;

        let conditionData = [{data:[], name:'Daystart'}, {data:[], name:'Daystart'}];
        this.triggers.forEach(trigger => {
            conditionData[2*trigger.id] = {
                data:[],
                name:this.formatTrigger(trigger)
            }
            conditionData[2*trigger.id+1] = {
                data:[],
                name:"Result after " + this.formatTrigger(trigger)
            }
        });

        let data = [
            {data:[], min:-1, max:+1, name:'active', blocky:true},
            {data:[], min:-90, max:90, name:'altitude', blocky:false},
            {data:[], min:0, max:100000, name:'lux', blocky:false}];

        let eventList = {data:[]};        
        this.events.forEach(event => {
            eventList.data.push({
                date:event.when,
                name:triggerEventName(EventTypes[event.event]),
                value:(180*event.pos.altitude/Math.PI) / 90
            });
        });
                                                        

        let tableHTML = '';  
        const self = this; 
        const dayStart =  this.config.dayStartsActive ? this.config.dayStartsActive : false;     

        while (offset < 60*24) {
            const mom = start.add(minutes, 'minutes');            
            const when = mom.toDate();
            const obj = this.testIfActive(when);
            
            if (this.debug) this.log(when, obj.active);

            conditionData[0].data[p] = {
                date : mom.toDate(),
                value : dayStart
            }; 
            conditionData[1].data[p] = {
                date : mom.toDate(),
                value : dayStart
            };  
            var all = dayStart;             
            this.triggers.forEach(trigger => {
                var item = conditionData[2*trigger.id];
                var itemAll = conditionData[2*trigger.id+1];

                var one = undefined;
                one = self.testTrigger(trigger, when, obj, one, true, true);
                all = self.testTrigger(trigger, when, obj, all, false, true);
                
                item.data[p] = {
                    date : mom.toDate(),
                    value : one
                };
                itemAll.data[p] = {
                    date : mom.toDate(),
                    value : all
                };                
            });

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
            offset += minutes;
            p++;

            const e = this.fetchEventAt(when);
            const et = triggerEventName(e ? EventTypes[e.event] : -1);
            tableHTML += '<thead class="thead-dark"><tr><th colspan="4">';
            tableHTML += mom.format('LT')+', ';
            tableHTML += formatRadians(obj.pos.altitude)+', ';
            tableHTML += Math.round(obj.lux) +', ';
            tableHTML += et + '</th></tr></thead>';
            tableHTML += '<tr><td></td><td>Daystart</td><td style="width:1px"> =&gt; </td><td style="width:1px;">'+formatState(dayStart)+'</td></tr>';;

            var last = dayStart;
            obj.conditions.forEach(val => {
                tableHTML += '<tr><td></td><td>';
                tableHTML += this.formatTrigger(val.trigger);
                tableHTML += '</td><td style="width:1px;white-space: nowrap;"> =&gt; ';
                switch (val.trigger.op) {
                    case TriggerOps.and:
                        tableHTML +=  formatState(last, false) + ' and ' + formatState(val.active, false) + ' = '
                        break;
                    case TriggerOps.or:
                        tableHTML +=  formatState(last, false) + ' or ' + formatState(val.active, false) + ' = '
                        break;
                    
                    case TriggerOps.discard:
                        tableHTML +=  '[IGNORE]' ;
                        break;
                    default:
                    tableHTML +=  '';
                }
                tableHTML += '</td><td style="width:1px;white-space: nowrap;">'+formatState(val.result, val.trigger.op!=TriggerOps.discard)+'</td></tr>';
                last = val.result;
            })
            
        }
        
        let s = fs.readFileSync(path.join(__dirname, './template.html'), { encoding: 'utf8' });

        s = s.replace('\{\{NAME\}\}', this.config.name);
        s = s.replace('\{\{DATA\}\}', JSON.stringify(data));
        s = s.replace('\{\{TABLE\}\}', tableHTML);
        s = s.replace('\{\{EVENT_DATA\}\}', JSON.stringify(eventList));
        s = s.replace('\{\{CONDITION_DATA\}\}', JSON.stringify(conditionData));
        return s;
    }
}
