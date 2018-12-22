const suncalc = require('suncalc'),
      moment = require('moment'),
      columnify = require('columnify');

const sampleConfig = require('./sampleConfig.json');
function nulllog(){};


console.log(sampleConfig);
console.stime = function(date) {
    return moment(date).format('LTS \t\t\t ll');
}
console.time = function(date) {
    console.log(console.stime(date));
}

const pseudoHomebridge = {
    version: "TEST DUMMY",
    hap:{
        Service: require("hap-nodejs").Service,
        Characteristic: require("hap-nodejs").Characteristic,
        uuid:0
    },
    platformAccessory:[],
    registerPlatform : function(pluginName, platformName, constructor, dynamic){
        const obj = new constructor(nulllog, sampleConfig);    
        
        let events = obj.eventsForDate(new Date(), false);
        console.log("TODAY's EVENT LIST");
        console.logEvents(obj.events); 
        console.log("CURRENT")
        console.log(obj.currentEvent, obj.posForTime(new Date()).altitude * 180 / Math.PI);
        
        obj.updateState();
    },
    
};
const plugin = require('../index.js')(pseudoHomebridge);










