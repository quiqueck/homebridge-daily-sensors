'use strict';
const web = require('./lib/web.js'),
      $ = require('./lib/helpers.js');

var Service, Characteristic, Accessory, UUIDGen;

module.exports = function(homebridge) {
    console.log("homebridge API version: " + homebridge.version);
    console.logEvents = $.logEvents;

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    web.setCharacteristics(Characteristic);

    const DailySensor = require('./lib/Sensor.js')(Service, Characteristic).DailySensor;
    const DailyGroup = require('./lib/Group.js')(Service, Characteristic, DailySensor).DailyGroup;
    const DailyPlatform = require('./lib/Platform.js')(Service, Characteristic, Accessory, UUIDGen, DailySensor, DailyGroup).DailyPlatform;
    //console.log(DailySensor, DailyGroup)
    homebridge.registerAccessory("homebridge-daily-sensors", "DailySensors", DailySensor);
    homebridge.registerAccessory("homebridge-daily-sensors", "DailyGroup", DailyGroup);
    homebridge.registerPlatform("homebridge-daily-sensors", "DailyPlatform", DailyPlatform, true);
}
