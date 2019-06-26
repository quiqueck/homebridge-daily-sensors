'use strict';
// based on the noble code from homebridge-avea-bulb

const moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),
      Noble = require('noble'),
      fs = require('fs'),
      $ = require('./helpers.js');


const REDISCOVER_TIMEOUT = 500;
const REDISCOVER_MAX_COUNT = 10;

module.exports.connect = function(ble, device, serviceUUID, switchCharacteristicUUID){
    const self = ble;
    let clearAllListeners = function (){            
        if (device.peripheral) {
            self.log.debug("Cleaning up Responders for ", device.peripheral.uuid)
            device.peripheral.removeAllListeners('connect');
            device.peripheral.removeAllListeners('disconnect');
            device.peripheral.removeAllListeners('servicesDiscover');
        }
        if (device.service) {
            self.log.debug("Cleaning up Service Responders for ", device.peripheral.uuid)
            device.service.removeAllListeners('characteristicsDiscover');
            device.service = undefined;
        } 
        if (device.switchCharacteristic) {
            self.log.debug("Cleaning up Characteristic Responders for ", device.peripheral.uuid)
            device.switchCharacteristic.unsubscribe((err)=>{});
            device.switchCharacteristic.removeAllListeners('data');
            device.switchCharacteristic = undefined;
        }
    }
    clearAllListeners();
    let rediscoverCount = 0;
    if (!device.peripheral.listeners('connect').some(t=>t == device.connectFunction)){
        device.peripheral.on('servicesDiscover', function(services){
            self.log.debug("Discovered Services:", services?services.length:0);
            device.service = services?services[0]:undefined;                 
            if (device.service === undefined){
                if (rediscoverCount++ < REDISCOVER_MAX_COUNT) {
                    self.log.info("Restarting Service Discovery: ct="+rediscoverCount+", id=" + device.peripheral.uuid);
                        setTimeout(()=>{ device.peripheral.discoverServices([serviceUUID])}, REDISCOVER_TIMEOUT);                     
                } else {
                    self.log.error("Service Discovery failed. Disconnecting " + device.peripheral.uuid);
                    device.peripheral.disconnect();
                }
                return;
            }
            rediscoverCount = 0;
            self.log.info('Discovered DailySwitch Service on', device.peripheral.uuid);
    
            device.service.on('characteristicsDiscover', function(characteristics){
                self.log.info('Discovered Characteristics', characteristics?characteristics.length:0);
                device.switchCharacteristic = characteristics?characteristics[0]:undefined;

                if (device.switchCharacteristic === undefined){
                    if (rediscoverCount++ < REDISCOVER_MAX_COUNT) {
                        self.log.info("Restarting Characteristic Discovery: ct="+rediscoverCount+", id=" + device.peripheral.uuid);
                        setTimeout(()=>{device.service.discoverCharacteristics([switchCharacteristicUUID])}, REDISCOVER_TIMEOUT);
                    } else {
                        self.log.error("Characteristic Discovery failed. Disconnecting " + device.peripheral.uuid);
                        device.peripheral.disconnect();
                    }
                    return;
                }

                self.log.debug('Discovered DailySwitch Characteristic on', device.peripheral.uuid);
                
                device.switchCharacteristic.on('data', function(data, isNotification) {
                    self.log.info('switch sent info: ', data.toString());
                    try {
                        const json = JSON.parse(data.toString());
                        self.callback(json);
                    } catch (e){
                        self.log.error(e);
                    }                        
                });

                //device.switchCharacteristic.read();
        
                // to enable notify
                device.switchCharacteristic.subscribe(function(error) {
                    if (error) {
                        self.log.error("Subscription Error", error);
                    }
                    self.log.debug('Subsribe');
                });
            });

            device.service.discoverCharacteristics([switchCharacteristicUUID]);
        });

        //connection handler;
        device.connectFunction = (error) => {   
            if (error){
                self.log.error("Connection Error:", error);
                return;
            }

            device.connected = true;             
            self.log.info('connected to peripheral: ' + device.peripheral.uuid);
            device.peripheral.discoverServices([serviceUUID]);
        };

        device.peripheral.on("connect", device.connectFunction);

        device.peripheral.on("disconnect", () => {
            clearAllListeners();
            device.connected = false;
            self.log.info("disconnected", device.id);
            device.discovered = false;
            //device.peripheral = undefined;

            if (self.attachedDiscoverCall === undefined) {
                self.attachedDiscoverCall = self.nobleDiscovered.bind(self);
                Noble.on("discover", self.attachedDiscoverCall);
            }
            //scanRestartCount = 0;
            self.startScanningWithTimeout();
            self.scanning = true;
        });
    }
    
    device.peripheral.connect();
}

