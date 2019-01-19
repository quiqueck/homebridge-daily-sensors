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

    const DailySensor = require('./lib/Sensor.js')(Service, Characteristic, Accessory, UUIDGen).DailySensor;
    console.log(DailySensor)
    homebridge.registerAccessory("homebridge-daily-sensors", "DailySensors", DailySensor);
}
