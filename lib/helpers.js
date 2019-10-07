const moment = require('moment'),
      columnify = require('columnify');

TriggerTypes = Object.freeze({"event":1, "time":2, "altitude":3, "lux":4, "calendar":5, "expression":6, "holiday":7});
TriggerWhen = Object.freeze({"greater":1, "less":-1, "both":0, "match":1, "no-match":-1, "both":0});
TriggerOps = Object.freeze({"set":0, "and":1, "or":2, 'discard':3});
EventTypes = Object.freeze({"nightEnd":1, "nauticalDawn":2, "dawn":3, "sunrise":4, "sunriseEnd":5, "goldenHourEnd":6, "solarNoon":7, "goldenHour":8, "sunsetStart":9, "sunset":10, "dusk":11, "nauticalDusk":12, "night":13, "nadir":14});

BluetoothSwitchTypes = Object.freeze({"simple":0, "tristate":1, "triggered":2});

const CommunicationTypes = Object.freeze({"http":1});
const WebTypes = Object.freeze({"Generic":0, "DailySensor":1, "DailySocket":2});

function triggerOpsName  (type){
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

function triggerEventName (type){
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
        case TriggerTypes.holiday:
            ret = 'Holiday'; 
            if (withOp) ret += ' in';
            break;
        case TriggerTypes.expression:
            ret = 'Expression';
            if (withOp) ret += ':';             
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

function formatTrigger(trigger){
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
        case TriggerTypes.holiday:                
            s += '[' + trigger.value.join(', ') + ']';
            break;
        case TriggerTypes.expression:                
            s += trigger.value.toString();                
            break;
        default:
            s += trigger.value;
    }
    s += ' (' + trigger.active + ')';
    return s;
}

function logEvents(events){
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
    if (date===undefined) date=moment();
    
    const m = (date instanceof Date) ? moment(date) : date;
    return moment({h: m.hours(), m: m.minutes(), s: m.seconds()});        
}

function formatRadians(rad){
    return formatNumber((rad/Math.PI)*180)+'°';
}

function formatNumber(nr){
    return parseFloat(Math.round(nr * 100) / 100).toFixed(2)
}


exports.TriggerTypes = TriggerTypes;
exports.TriggerWhen = TriggerWhen;
exports.TriggerOps = TriggerOps;
exports.EventTypes = EventTypes;
exports.BluetoothSwitchTypes = BluetoothSwitchTypes;
exports.CommunicationTypes = CommunicationTypes;
exports.WebTypes = WebTypes;

exports.triggerOpsName = triggerOpsName;
exports.triggerEventName = triggerEventName;
exports.triggerTypeName = triggerTypeName;
exports.triggerWhenName = triggerWhenName;
exports.dayOfWeekNameList = dayOfWeekNameList;
exports.formatTrigger = formatTrigger;

exports.logEvents = logEvents;

exports.justTime = justTime;
exports.formatRadians = formatRadians;
exports.formatNumber = formatNumber;