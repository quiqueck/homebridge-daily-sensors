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

    const CustomTypes = require('./lib/CustomTypes.js')(Service, Characteristic, UUIDGen);
    const DailySensor = require('./lib/Sensor.js')(Service, Characteristic).DailySensor;
    const DailyGroup = require('./lib/Group.js')(Service, Characteristic, DailySensor).DailyGroup;
    const DailySocket = require('./lib/DailySocket.js')(Service, Characteristic, CustomTypes);
    const DailyPlatform = require('./lib/Platform.js')(Service, Characteristic, Accessory, UUIDGen, DailySensor, DailyGroup, DailySocket.DailySocket, DailySocket.DailyLight).DailyPlatform;
    //console.log(DailySensor, DailyGroup)
    homebridge.registerAccessory("homebridge-daily-sensors", "DailySensors", DailySensor);
    homebridge.registerAccessory("homebridge-daily-sensors", "DailyGroup", DailyGroup);
    homebridge.registerAccessory("homebridge-daily-sensors", "DailySocket", DailySocket.DailySocket);
    homebridge.registerAccessory("homebridge-daily-sensors", "DailyLight", DailySocket.DailyLight);
    homebridge.registerPlatform("homebridge-daily-sensors", "DailyPlatform", DailyPlatform, true);
}
