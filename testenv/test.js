const suncalc = require('suncalc'),
    moment = require('moment'),
    columnify = require('columnify'),
    https = require('https'),
    fs = require('fs'),
    icalExpander = require('ical-expander'),
    xmlParser = require('xml-js'),
    ical = require('../lib/iCal.js');

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

const username = "",
      password = "",
      url = "";

ical.loadEventsForDay(moment(), {url:url, username:username, password:password, type:'caldav'}, (list, start, end) => {
    //console.log(list);
    ical.eventsAt(moment(), list).map(e => console.log(e));
});