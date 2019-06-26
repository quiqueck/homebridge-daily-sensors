const suncalc = require('suncalc'),
      moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),  
      holidays = require('date-holidays'), //https://www.npmjs.com/package/date-holidays#supported-countries-states-regions    
      ical = require('./iCal.js'),
      web =  require('./web.js'),
      $ = require('./helpers.js');

const constantSolarRadiation = 1361 //Solar Constant W/m²
const arbitraryTwilightLux = 6.32     // W/m² egal 800 Lux
let Service, Characteristic;

      
class DailySensor {
    constructor(log, config, api, owner) {
        this.owner = owner;

        if (!config.location ||
            !Number.isFinite(config.location.latitude) ||
            !Number.isFinite(config.location.longitude)) {
        throw new Error('Daylight Sensors need a location to work properly');
        }
        moment.locale(config.locale ? config.locale : 'en');

        this.math = new (require('./mymath.js'))(this);
        const self = this; 
        this.config = config === undefined ? {} : config;       
        this.debug = this.config.debug === undefined ? false : this.config.debug;
        
        if (log.debug !== undefined) this.log = log;        
        else this.log = {info:log, debug:this.debug?log:function(){}, error:console.error};
        if (this.config.debug !== undefined)
            this.log.debug = this.debug?this.log.info:function(){};

        this.override = undefined;
        this.fixedConfig = true;        
        this.isActive = false;
        this.currentLux = -1;
        this.luxService = undefined; 
        this.dailyRandom = [];  
        this._setConfig(config);
        this.port = this.config.port ? this.config.port : 0;
        this.webPath = path.resolve('/', './' + (this.config.webPath ? this.config.webPath : this.config.name.toLowerCase()) + '/'); 
        this.bluetooth = this.config.bluetoothSwitch == undefined ? {} : this.config.bluetoothSwitch;
        this.bluetooth.type = this.bluetooth.type !== undefined ? $.BluetoothSwitchTypes[this.bluetooth.type] : $.BluetoothSwitchTypes.simple;
        this.bluetooth.lastEvent = {when:undefined, state:-1}
        

        this.log.debug("Loading Events");
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
        this.switchService = undefined;
        this.luxService = undefined;
        if (api) {
            // Save the API object as plugin needs to register new accessory via this object
            this.api = api;
        
            // Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories.
            // Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
            // Or start discover new accessories.
            /*this.api.on('didFinishLaunching', function() {
                self.log.info("DidFinishLaunching", this.config.name);
            }.bind(this));*/
        }

        this.log.info("Updating Initial State for " + this.config.name);
        this.updateState();

        web.startServerForSensor(this);
        
        this.log.debug("Finished Initialization");
    }

    restartDiscovery() {
        if (this.owner && this.owner.ble){
            this.log.info("Should restart BLE Discovery");
            this.owner.ble.restartDiscovery();
        }
    }

    receivedSwitchEvent(data){
        this.log.info("Handling Event", data);
        if (data.state !== undefined){
            this.bluetooth.lastEvent = {
                when:new Date(),
                state:data.state
            };

            if (this.bluetooth.type == $.BluetoothSwitchTypes.triggered) {
                this.updateState(this.bluetooth.lastEvent.when)
            } else {        
                this.override = data.state;
                this.syncSwitchState();                 
            } 
        }
    }

    setConfig(config){
        this._setConfig(config);

        this.switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setProps({ minValue:0, maxValue: this.bluetooth.type == $.BluetoothSwitchTypes.simple ? 1 : 2 });

        this.fetchEvents(new Date());
        this.updateState();
    }

    _setConfig(config){
        this.log.info("Updating Config for " + config.name);
        this.config = config;             
        this.debug = this.config.debug || false;
        this.timeout = this.config.tickTimer ? this.config.tickTimer : 30000;
        this.dayStart = this.config.dayStartsActive ? this.config.dayStartsActive : false;
        if (this.config.location.country === undefined) {
            this.holidays = {
                isHoliday:function(date) { return false;}
            }
        } else {
            this.holidays = new holidays(this.config.location.country, this.config.location.state, this.config.location.town);  
        }


        this.parseTrigger(config.trigger);
    }

    getIsActive() {
        return (this.override!==undefined) ? (this.override==0 ? false : true)  : this.isActive;
    }

    configureAccesory(acc){
        let infoService = acc.getService(Service.AccessoryInformation);
        let switchService = acc.getService(Service.StatelessProgrammableSwitch);
        let lusService = switchService; //acc.getService(Service.LightSensor);
        this.configureServices(infoService, lusService, switchService);
    }

    configureServiceCharacteristics(informationService, luxService, switchService){
        const when = new Date();
        const pos = this.posForTime(when);
        const newLux = this.luxForTime(when, pos);
        this.currentLux = Math.round(newLux);  

        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Ambertation")
            .setCharacteristic(Characteristic.Model, "Daily Sensor")
            .setCharacteristic(Characteristic.SerialNumber, "0000")
            .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);           
            
        if (!this.config.noPowerState)
            switchService.addCharacteristic(Characteristic.On);
        if (!this.config.noLux)
            switchService.addCharacteristic(Characteristic.CurrentAmbientLightLevel);

        this.configureServices(informationService, luxService, switchService)
    }

    configureServices(informationService, luxService, switchService){ 
        const self = this;

        if (!self.config.noLux) {
            luxService
                .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                .on('get', callback => callback(null, self.currentLux));
                    
            luxService.setCharacteristic(
                Characteristic.CurrentAmbientLightLevel,
                this.currentLux
            ); 

            luxService
                .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                .setProps({ perms: [Characteristic.Perms.READ] });  
        }
        
        if (!self.config.noPowerState) {
            switchService
                .getCharacteristic(Characteristic.On)
                .on('get', callback => callback(null, self.getIsActive()));

            switchService
                .getCharacteristic(Characteristic.On)
                .setProps({ perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY] }); 
        }           

        switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setProps({ minValue:0, maxValue: this.bluetooth.type == $.BluetoothSwitchTypes.simple ? 1 : 2 });

        switchService
            .getCharacteristic(Characteristic.ServiceLabelIndex)
            .setValue(1);


        this.switchService = switchService;        
        this.luxService = luxService;
        //this.luxService.internalName = this.name + " (Lux)";
        this.informationService = informationService;
        

        this.updateState()
        this.syncSwitchState();
    }

    getServices(useInfo) {         
        if (this.switchService == undefined){
            //Info about this plugin
            let informationService = useInfo;
            if (!useInfo) informationService = new Service.AccessoryInformation ();
            
            //informationService.subtype = "info";
            //this.luxService = new Service.LightSensor();
            let switchService = new Service.StatelessProgrammableSwitch(this.config.name, this.config.name);            

            let luxService = switchService;//new Service.LightSensor(this.config.name, 'lux');            

            this.configureServiceCharacteristics(informationService, luxService, switchService);  
        }   
        
        return [this.informationService, this.switchService/*, this.luxService*/]; 
    }

    identify(callback) {
        this.log.info('Identify requested!');
        callback(null);
    }

    parseTrigger(trigger){
        if (trigger===undefined) trigger = [];
        this.triggers = []
        let ID = 0;
        trigger.forEach(val => {
            const type = $.TriggerTypes[val.type];
            const op = val.op !== undefined ? $.TriggerOps[val.op] : $.TriggerOps.set;
            let value = '';
            let random = val.random;
            ID++;
            let constants;
            switch(type){
                case $.TriggerTypes.event:
                    value = $.EventTypes[val.value];
                break;
                case $.TriggerTypes.time:
                    value = moment(val.value, ['h:m a', 'H:m']).toDate();
                break;
                case $.TriggerTypes.altitude:
                    value = (val.value / 180.0) * Math.PI;
                    random = (val.random / 180.0) * Math.PI;
                    //suncalc.addTime(val.value, ID+'_AM', ID+'_PM');
                break;
                case $.TriggerTypes.lux:
                    value = Math.round(val.value);
                break;
                case $.TriggerTypes.calendar:
                    value = val.value; //regex
                break;
                case $.TriggerTypes.holiday:
                    value = val.value; //array
                break;
                case $.TriggerTypes.expression:
                    val.active = val.active == undefined ? true : val.active;
                    val.trigger = val.trigger == undefined ? 'both' : val.trigger;

                    //we need this cause we cannot bind the context to our methods.
                    //we know that falling back to string replacements is a very bad idea :()
                    var withSelf = val.value.replace(/(Time\()\s*(['"])\s*([\d:. ]+(am|pm)?)\s*(\2)\s*(\))/gm, '$1self, $2$3$5$6');
                    withSelf = withSelf.replace(/(dailyrandom\()\s*(\))/gm, '$1self$2');
                    withSelf = withSelf.replace(/(dailyrandom\()\s*([+-]?\d+(\.\d+)?)\s*((,)\s*([+-]?\d+(\.\d+)?))?\s*(\))/gm, '$1self, $2$5$6$8');
                    this.log.debug("Rewrote expression:", withSelf);
                    value = this.math.compile(withSelf); //string                    
                    constants = {};
                    for(var n in val.constants) {
                        const r = /(Time\()\s*([\d:. ]+(am|pm)?)\s*(\))/gm
                        let v = val.constants[n];
                        if (val.constants[n] !== undefined && val.constants[n].replace) {                           
                            if (v.match(r)){
                                v = new this.math.Time(this, val.constants[n].replace(r, '$2'));
                            } 
                        }
                        constants[n] = v;
                    }
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
                when: $.TriggerWhen[val.trigger ? val.trigger : 'greater'],
                op:op,
                random: random,
                daysOfWeek: daysOfWeek,
                constants:constants
            });
        });
        this.log.debug(this.triggers);
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
        

        //this.log.info(pos.altitude- alt, minRad, Math.sin(alt) * 10000);
        return Math.max(0.0001, Math.sin(alt) * 10000);
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
                this.log.debug("New Calendar Events:\n", list.map(e => "  " + moment(e.startDate).format('LTS') + " - " + moment(e.endDate).format('LTS') + ": "+ e.summary).join("\n"));

                this.calendar = list;
            });
        }

        var e1 = this.eventsForDate(when, false);
        var e2 = this.eventsForDate(moment().add(1, 'day').toDate(), false);
        var e0 = this.eventsForDate(moment().add(-1, 'day').toDate(), false);

        this.events = e0.concat(e1).concat(e2);
        this.log.debug(moment(when).format('LTS'));
        this.events.forEach(event => {
            this.log.debug(moment(event.when).format('LTS'), event.event, $.formatRadians(event.pos.altitude), Math.round(event.lux));
        });

        this.dailyRandom = [];

        this.triggers.forEach(trigger => {
            let r = trigger.random ? trigger.random : 0;
            if (r==0){
                trigger.randomizedValue = trigger.value;
                return;
            }

            let rnd = Math.random() * 2*r - r;
            switch (trigger.type ) {
                case $.TriggerTypes.lux:
                case $.TriggerTypes.altitude:
                    trigger.randomizedValue = trigger.value + rnd;
                    break;
                case $.TriggerTypes.time:
                    let m = moment(trigger.value);
                    m = m.add(rnd, 'minutes');
                    trigger.randomizedValue = m.toDate();
                    break;
                default:
                    trigger.randomizedValue = trigger.value
            }
            
            this.log.debug("generated", trigger.randomizedValue, "from", trigger.value, "+", trigger.random, rnd)            
        });
    }

    matchesCalEventNow(when, regex) {
        const r = new RegExp(regex);
        
        const events = ical.eventsAt(moment(when), this.calendar).filter(e => e.summary.match(r)!==null);
        this.log.debug("Matching Events for '" + regex + "' at "+ moment(when).format('LTS') +":\n", events.map(e => "  " + moment(e.startDate).format('LTS') + " - " + moment(e.endDate).format('LTS') + ": "+ e.summary).join("\n"));            
        
        return events.length > 0;
    }

    isHoliday(when, types) {
        if (types === undefined) types = ['public', 'bank'];
        if (types.length === undefined) types = [types];
        const h = this.holidays.isHoliday(when);
        //this.log.info(time.toString(), h);
        if (h !== false){
            return types.indexOf(h.type)>=0;
        } else {
            return false;
        }
    }

    queueNextEvent() {
        const now = moment();
        const day = moment({h: 0, m: 0, s: 1});
        var days = this.activeDay ?  Math.abs(moment.duration(day.diff(this.activeDay)).asDays()) : 1;
        this.log.debug("Curent Event: ", this.fetchEventAt(now.toDate()), "days passed", days);
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
                case $.TriggerOps.and:
                    result = result && r;
                    break;
                case $.TriggerOps.or:
                    result = result || r;
                    break;
                case $.TriggerOps.discard:
                    break;
                default:
                    result = r;
            }
        }

        function changeByTrigger(trigger, what){
            if (what && (trigger.when == $.TriggerWhen.greater || trigger.when == $.TriggerWhen.both)) {
                
                concat(trigger.active);
                if (!silent) obj.conditions.push({trigger:trigger, active:trigger.active, result:result});
                if (!silent) self.log.debug("    Trigger changed result -- " + $.formatTrigger(trigger) + " => " + result);
            } else if (!what && (trigger.when == $.TriggerWhen.less || trigger.when == $.TriggerWhen.both)) {
                concat(!trigger.active);
                if (!silent) obj.conditions.push({trigger:trigger, active:!trigger.active, result:result});    
                if (!silent) self.log.debug("    Trigger changed result -- " + $.formatTrigger(trigger) + " => " + result);
            }
        } 

        switch(trigger.type) {
            case $.TriggerTypes.time:                    
                changeByTrigger(trigger, $.justTime(when) > $.justTime(trigger.randomizedValue));
            break;
            case $.TriggerTypes.event:
                const event = this.fetchEventAt(when);
                if (event) {
                    changeByTrigger(trigger, $.EventTypes[event.event] == trigger.value);
                }
            break;
            case $.TriggerTypes.altitude:
                changeByTrigger(trigger, obj.pos.altitude > trigger.randomizedValue );
            break;
            case $.TriggerTypes.lux:
                changeByTrigger(trigger, obj.lux > trigger.randomizedValue );
            break;
            case $.TriggerTypes.calendar:
                changeByTrigger(trigger, this.matchesCalEventNow(when, trigger.value) );
            break;
            case $.TriggerTypes.holiday:
                changeByTrigger(trigger, this.isHoliday(when, trigger.value) );
            break;
            case $.TriggerTypes.expression:
                const res = trigger.value.run(trigger.constants, when);
                if (typeof(res)==='boolean') {
                    changeByTrigger(trigger, res);
                } else {
                    this.log.debug("Math Expression forced override value '"+res+"'");
                    this.override = res;
                }
            break;
            default:

        }

        return result;
    }

    testIfActive(when, triggerList) {
        if (triggerList === undefined) triggerList = this.triggers;
        const pos = this.posForTime(when);
        const newLux = this.luxForTime(when, pos);
        let obj = {
            active:false,
            pos:pos,
            lux:newLux,
            conditions:[]
        };
        
        const self = this;
        let result = this.dayStart;               
        this.log.debug("Starting day with result   -- " + result);    
        triggerList.forEach(trigger => result = self.testTrigger(trigger, when, obj, result, false, false));

        obj.active = result;
        return obj;
    }

    updateState(when) {
        if (this.switchService == undefined) return;
        if (when === undefined) when = new Date();

        //make sure the switch has the same state
        this.currentSwitchValue = this.switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .value;

        if (this.override === undefined) {
            if (this.currentSwitchValue != Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS  && !this.getIsActive()) {
                this.log.debug("FORCE SEND DOUBLE_PRESS");
                this.syncSwitchState();            
            } else if (this.currentSwitchValue != Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS && this.currentSwitchValue != Characteristic.ProgrammableSwitchEvent.LONG_PRESS && this.getIsActive()) {
                this.log.debug("FORCE SEND SINGLE_PRESS");
                this.syncSwitchState();
            } else {
                //this.syncSwitchState();
            }
            //this.log.info("STATE", val, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS, Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS);
        }

        const obj = this.testIfActive(when);
        const pos = obj.pos;
        const newLux = obj.lux;
        const result = obj.active;
        
        const self = this;               
        
        if (!this.config.noLux && this.luxService && Math.abs(this.currentLux - newLux)>1){
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

        this.log.debug("    State at " + moment(when).format('LTS'), this.isActive, this.currentLux);
        this.queueNextEvent();
    }

    syncSwitchState(){
        if (!this.config.noPowerState){
            this.switchService.setCharacteristic(
                Characteristic.On,
                this.getIsActive()
            );
        }

        let action = 0;
        if (this.bluetooth.type == $.BluetoothSwitchTypes.simple || this.override === undefined || this.override < 2) {
            action = this.getIsActive() ? Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS : Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS;
        } if (this.bluetooth.type != $.BluetoothSwitchTypes.simple && this.override == 2) {
            action = Characteristic.ProgrammableSwitchEvent.LONG_PRESS;            
        }
        this.log.debug("Sending", action==Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS?'SINGLE':(action==Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS?'DOUBLE':(action==Characteristic.ProgrammableSwitchEvent.LONG_PRESS?'LONG':action)))

        this.switchService.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, action);
        /*this.switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .setValue(action);*/

        this.currentSwitchValue = this.switchService
            .getCharacteristic(Characteristic.ProgrammableSwitchEvent)
            .value;
    }

    iterateDay(cb, startYesterday, deltaMinutes){
        if (startYesterday === undefined) startYesterday = false;
        if (deltaMinutes === undefined) deltaMinutes = 1;
        let iterations = Math.round(24*60 / deltaMinutes) + (startYesterday?2:1);
        let time = moment().startOf('day').subtract(startYesterday?deltaMinutes:0, 'minutes');    
    
        while (iterations>0) {
            cb(iterations, time);
            
            time.add(deltaMinutes, 'minutes');
            iterations--;
        }
    }
}

module.exports = function(service, characteristic){
    Service = service;
    Characteristic = characteristic;

    return {
        DailySensor:DailySensor
    }
}