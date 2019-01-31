const suncalc = require('suncalc'),
    moment = require('moment'),
    columnify = require('columnify'),
    https = require('https'),
    fs = require('fs'),
    icalExpander = require('ical-expander'),
    xmlParser = require('xml-js'),
    ical = require('../lib/iCal.js'),
    ble = require('../lib/ble.js')({info:console.log, debug:console.log, error:console.error}, ['99b97d90d3e8454881f5489e959bc4f7'], (json)=>{
        console.log("got data ", json);
    });

const sampleConfig = require('./sampleConfig.json');

function nulllog(msg) {
    console.log(msg);
};


console.stime = function (date) {
    return moment(date).format('LTS \t\t\t ll');
}
console.time = function (date) {
    console.log(console.stime(date));
}

const pseudoHomebridge = {
    version: "TEST DUMMY",
    hap: {
        Service: require("hap-nodejs").Service,
        Characteristic: require("hap-nodejs").Characteristic,
        uuid: 0
    },
    platformAccessory: [],
    registerPlatform: function (pluginName, platformName, constructor, dynamic) {
        const obj = new constructor(nulllog, sampleConfig);

        let events = obj.eventsForDate(new Date(), false);
        console.log("TODAY's EVENT LIST");
        console.logEvents(obj.events);
        console.log("CURRENT")
        console.log(obj.currentEvent, obj.posForTime(new Date()).altitude * 180 / Math.PI);

        obj.updateState();
    },
    registerAccessory: function (pluginName, platformName, constructor, dynamic) {
        const obj = new constructor(nulllog, sampleConfig);

        let events = obj.eventsForDate(new Date(), false);
        console.log("TODAY's EVENT LIST");
        console.logEvents(obj.events);
        console.log("CURRENT")
        console.log(obj.currentEvent, obj.posForTime(new Date()).altitude * 180 / Math.PI);

        obj.updateState();
    },

};
//const plugin = require('../index.js')(pseudoHomebridge);

/*const username = "",
      password = "",
      url = "";

ical.loadEventsForDay(moment(), {url:url, username:username, password:password, type:'caldav'}, (list, start, end) => {
    //console.log(list);
    ical.eventsAt(moment(), list).map(e => console.log(e));
});*/

//const code = mymath.compile('events.isHoliday(Time("2018-05-31 16:30:23"))');
const sensor = {
    dailyRandom:[],
    config: {
        location:{
            country:'DE',
            state:'BY'
        }
    },
    bluetooth:{lastEvent:{when:new Date()}},
    posForTime:function(a) { return {altitude:1.2}; },
    luxForTime:function(a, b) { return 2; },
    matchesCalEventNow:function(a, b) { return false; },
    fetchEventAt:function(a) { return false; },
}

const s2 = {
    dailyRandom:[],
    config: {
        location:{
            country:'DE',
            state:'BY'
        }
    },
    posForTime:function(a) { return {altitude:1.2}; },
    luxForTime:function(a, b) { return 2; },
    matchesCalEventNow:function(a, b) { return false; },
    fetchEventAt:function(a) { return false; },
}
const mymath = new (require('../lib/mymath.js'))(sensor)
const mymath2 = new (require('../lib/mymath.js'))(s2)
const code = mymath.compile("t = Time(self, '6:30 am').addMinutes(20);t>now");
const code2 = mymath2.compile('dailyrandom(self,2, 10)');
const scope = {    
    a : new mymath.Time(sensor, '23:30'),
    b : new mymath.Time(s2, '17:30')
}
const now = moment();
console.log('a:', scope.b.toString())
console.log('b:', scope.b.toString())
console.log('now:', now.format('LLLL'))
console.log(code.run(scope, now));
console.log(typeof(code.run(scope, now)));
console.log(typeof(code2.run(scope, now)));

console.log("Started");