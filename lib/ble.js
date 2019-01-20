'use strict';
// based on the noble code from homebridge-avea-bulb

const moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),
      Noble = require('@s524797336/noble-mac'),
      fs = require('fs'),
      $ = require('./helpers.js');

var scanRestartCount = 0;
const maxScanRestarts = 5;
const serviceUUID = '0818c2dd-1276-4105-9e65-0d10c8e27e35';
const switchCharacteristicUUID = "3e989a75-3437-471e-a50a-20a838afcce7";

class BluetoothClient {
    constructor(log, devices, callback) {
        this.log = log;
        this.callback = callback;
        this.scanning = false;
        this.devices = devices.map(d => {return {id:d, peripheral:undefined, connected:false};});

        //Initialise the Noble service for talking to enabled devices
        Noble.on('stateChange', this.nobleStateChange.bind(this));
        Noble.on('scanStop', this.nobleScanStop.bind(this));
    }

    allConnected(){
        return this.devices.some(item => item.peripheral !== undefined);
    }

    deviceWithID(bid){
        return this.devices.find(item => item.id == bid); 
    }

    startConnection(device){
        const self = this;
        device.peripheral.on("connect", () => {
            device.connected = true;
            self.log.info("connected", device.id);
        });
        device.peripheral.on("disconnect", () => {
            device.connected = false;
            self.log.info("disconnected", device.id);
            device.peripheral = undefined;

            if (self.attachedDiscoverCall === undefined) {
                self.attachedDiscoverCall = self.nobleDiscovered.bind(self);
                Noble.on("discover", self.attachedDiscoverCall);
            }
            scanRestartCount = 0;
            self.startScanningWithTimeout();
            self.scanning = true;
        });
        
        device.peripheral.connect(function(error) {
            self.log.debug('connected to peripheral: ' + device.peripheral.uuid);
            device.peripheral.discoverServices([serviceUUID], function(error, services) {
                var deviceInformationService = services[0];
                self.log.debug('discovered device information service');
        
                deviceInformationService.discoverCharacteristics([switchCharacteristicUUID], function(error, characteristics) {
                    self.log.debug('discovered switch characteristic');
                    device.switchCharacteristic = characteristics[0];

                    device.switchCharacteristic.on('data', function(data, isNotification) {
                        self.log.debug('switch sent info: ', data.toString());
                        try {
                            const json = JSON.parse(data.toString());
                            self.callback(json);
                        } catch (e){
                            this.log.error(e);
                        }                        
                    });
              
                    // to enable notify
                    device.switchCharacteristic.subscribe(function(error) {
                        self.log.debug('notification on');
                    });
              });
            });
        });
    }

    // Noble State Change
    nobleStateChange (state) {
        if (state == "poweredOn") {
            this.log.debug("Starting Noble scan..");
            Noble.on('scanStop', function () {
                setTimeout(function () {
                    if (!this.allConnected){
                        this.log.debug('Restart from ScanStop');
                        this.startScanningWithTimeout();
                    }
                }.bind(this), 2500);
            }.bind(this));
            
            if (this.attachedDiscoverCall === undefined) {
                this.attachedDiscoverCall = this.nobleDiscovered.bind(this);
                Noble.on("discover", this.attachedDiscoverCall);
            }
            this.startScanningWithTimeout();
            this.scanning = true;
        } else {
            this.log.debug("Noble state change to " + state + "; stopping scan.");
            Noble.removeAllListeners('scanStop');            
            Noble.stopScanning();
            Noble.removeAllListeners('discover');
            this.scanning = false;
        }
    }
    // Noble Discovery
    nobleDiscovered(peripheral) {
        this.log.debug("Discovered:", peripheral.uuid, peripheral.advertisement.localName);
        const device = this.deviceWithID(peripheral.uuid);

        if (this.devices.length == 0) {
            this.stopScanning();
            this.scanning = false;
        } else if (device !== undefined && device!==null && device.peripheral===undefined) {
            device.peripheral = peripheral;                
            this.log.info("Found new Device ", peripheral.advertisement.localName);

            if (this.allConnected()){
                this.stopScanning();
                this.scanning = false;
            }
            this.startConnection(device);
        } else if (device !== undefined && device!==null) {
                this.log.info("Lost device " + device.id + " reappeared!");
                device.peripheral = peripheral;
                if (device.peripheral.state != "connected") {
                    Noble.stopScanning();
                    this.scanning = false;
                    this.startConnection(device);
                } else {
                    this.log.info("Undefined state");
                }
        } else {
            this.log.debug("    ... Ignoring");
        }
    }

    // Noble Stop Scan
    nobleScanStop() {
        this.log.debug("ScanStop received");
        if (!this.allConnected() /*&& maxScanRestarts > scanRestartCount++*/) {
            //Retry scan
            setTimeout(function () {
                this.log.debug('Restarting Scan', this.allConnected(), scanRestartCount);
                this.startScanningWithTimeout();
            }.bind(this), 2500);
        } else {
            this.scanning = false;
        }
    }

    startScanningWithTimeout() {
        Noble.startScanning(serviceUUID, false);
        setTimeout(function () {
            if (Noble.listenerCount('discover') == 0) { return; }
            this.log.debug('Discovery timeout');
            Noble.stopScanning();
            this.scanning = false;
        }.bind(this), 12500);
    }

    stopScanning() {
        if (this.attachedDiscoverCall !== undefined){
            Noble.removeListener('discover', this.attachedDiscoverCall);
            this.attachedDiscoverCall = undefined;
        }
        this.log.debug("Stop Scanning?", Noble.listenerCount('discover') );
        
        if (Noble.listenerCount('discover') == 0) {
            Noble.removeAllListeners('scanStop');
            Noble.stopScanning();
        }
    }

    onBulbConnect(error, peripheral) {
        if (error) {
            this.log.error("Connecting to " + peripheral.address + " failed: " + error);
            this.onDisconnect(error, peripheral);
            return;
        }
        this.log.debug("Connected to " + peripheral.address);
    }

    onDisconnect(error, peripheral) {
        peripheral.removeAllListeners();
        this.log.info("Disconnected");
        this.nobleDiscovered(peripheral);
    }
}

      module.exports = function(log, devices, callback){     
        if (devices.length == 0) return undefined;
        const ble = new BluetoothClient(log, devices, callback);            
        return ble;
    }