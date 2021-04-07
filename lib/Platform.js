const packageJSON = require("../package.json"),
      path = require('path'),  
      web =  require('./web.js'),
      $ = require('./helpers.js')

let Service, Characteristic, Accessory, UUIDGen, DailySensor, DailyGroup, DailySocket, DailyLight, Services;

class DailyPlatform {
    services = []

    constructor(log, config, api) {
        if (config.services && Array.isArray(config.services)){
            this.services = this.services.concat(config.services.map(cfg => new Services.DailyService(log, cfg, api)))
        } else {
            this.services.push(new Services.DailyService(log, config, api))
        }
    }

    configureAccessory(accessory) {
        for (let i = 0; i<this.services.length; i++){
            const s = this.services[i]
            if (s.configureAccessory(accessory)) {
                break;
            }
        }
        
    }

    getKnownAccessoryWithName(name){
        return Services.knownAccesories.find(acc => acc.displayName == name);
    }

    getAccessoryWithName(name) {
        return Services.this.accessories.find(acc => acc.config.name == name);
    }

    hasAccessoryWithName(name){
        console.log("HAS", name, Services.this.accessories.length)
        return Services.this.accessories.some(acc => acc.config.displayName == name);
    }
}

module.exports = function(service, characteristic, accessory, uuidGen, services, dailySensor, dailyGroup, dailySocket, dailyLight){
    Service = service;
    Characteristic = characteristic;
    Accessory = accessory;
    UUIDGen = uuidGen;
    DailySensor = dailySensor;
    DailyGroup = dailyGroup;
    DailySocket = dailySocket;
    DailyLight = dailyLight;
    Services = services;
    

    return {
        DailyPlatform:DailyPlatform
    }
}