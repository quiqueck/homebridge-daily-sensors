'use strict';
// based on the noble code from homebridge-avea-bulb

const moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),
      Noble = require('noble'),
      fs = require('fs'),
      $ = require('./helpers.js');

var scanRestartCount = 0;
const maxScanRestarts = 5;
const DISCOVERY_RUN_TIME = 20000;
const DISCOVERY_PAUSE_TIME = 5000;
const serviceUUID = '0818c2dd-1276-4105-9e65-0d10c8e27e35';
const serviceUUIDShort = '0818c2dd127641059e650d10c8e27e35';
const switchCharacteristicUUID = "3e989a75-3437-471e-a50a-20a838afcce7";

class BluetoothClient {
    constructor(log, devices, callback) {
        this.log = log;
        this.callback = callback;
        this.scanning = false;
        this.devices = devices.map(d => {return {id:d, peripheral:undefined, connected:false, discovered:false};});

        //Initialise the Noble service for talking to enabled devices
        Noble.on('stateChange', this.nobleStateChange.bind(this));
        this.scanStopListener = this.nobleScanStop.bind(this)
        Noble.on('scanStop', this.scanStopListener);
    }

    allDiscovered(){
        return !this.devices.some(item => !item.discovered );
    }

    deviceWithID(bid){
        return this.devices.find(item => item.id == bid); 
    }

    startConnection(device){
        const self = this;
        console.log("will connect", device.id, device.peripheral.listeners('connect'));
        
        if (!device.peripheral.listeners('connect').some(t=>t == device.connectFunction)){
            device.connectFunction = () => {
                device.connected = true;
                self.log.info("connected", device.id);
            };
            device.peripheral.on("connect", device.connectFunction);

            device.peripheral.on("disconnect", () => {
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
        
        device.peripheral.connect(function(error) {
            self.log.debug('connected to peripheral: ' + device.peripheral.uuid);
            device.peripheral.discoverServices([serviceUUID], function(error, services) {
                var deviceInformationService = services[0];
                self.log.debug('discovered DailySwitch service');
        
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
            
            if (this.attachedDiscoverCall === undefined) {
                this.attachedDiscoverCall = this.nobleDiscovered.bind(this);
                Noble.on("discover", this.attachedDiscoverCall);
            }

            this.startScanningWithTimeout();
            this.scanning = true;
        } else {
            this.log.debug("Noble state change to " + state + "; stopping scan.");
            if (this.scanStopListener !== undefined) {
                Noble.removeListener('scanStop', this.scanStopListener);
                this.scanStopListener = undefined;
            }            
            if (this.attachedDiscoverCall !== undefined){
                Noble.removeListener('discover', this.attachedDiscoverCall);
                this.attachedDiscoverCall = undefined;
            }
            this.log.debug('State Changed to '+state+'. Stopping Scan for Service ' + serviceUUID);
            Noble.stopScanning();
            
            this.scanning = false;
        }
    }
    
    // Noble Stop Scan
    nobleScanStop() {
        this.log.debug('ScanStop received: allFound=' + this.allDiscovered() + ', ct=' + scanRestartCount);
        /*scanRestartCount++;
        if (!this.allDiscovered() && maxScanRestarts > scanRestartCount) {
            //Pause Scanning for a while...
            setTimeout(function () {
                this.log.debug('Restarting Scan', this.allDiscovered(), scanRestartCount);
                this.startScanningWithTimeout();
            }.bind(this), DISCOVERY_PAUSE_TIME);
        } else {
            this.scanning = false;
        }*/
    }

    startScanningWithTimeout() {
        if (this.scanStopListener !== undefined) {
            //someone deleted our listener :()
            if (!Noble.listeners('scanStop').some(t=>t===this.scanStopListener)){
                this.log.error("Outsider deleted listener ...restoring");
                this.scanStopListener = this.nobleScanStop.bind(this)
                Noble.on('scanStop', this.scanStopListener);
            }
        } else {
            this.scanStopListener = this.nobleScanStop.bind(this)
            Noble.on('scanStop', this.scanStopListener);
        }

        const self = this;
        this.log.info("Start Scanning for Service", serviceUUID);
        Noble.startScanning([serviceUUID], false);
        setTimeout(function () {
            if (Noble.listenerCount('discover') == 0) { return; }
            this.log.debug('Discovery timeout. Stopping Scan for Service ' + serviceUUID);
            Noble.stopScanning();
            this.scanning = false;

            this.restartTimerCall = setTimeout(function () {
                scanRestartCount++;
                this.restarscanStopListenertTimerCall = undefined;
                this.log.debug('Restarting Discovery allFound=' + this.allDiscovered() + ', ct=' + scanRestartCount);
                this.startScanningWithTimeout();
            }.bind(this), DISCOVERY_PAUSE_TIME);            
        }.bind(this), DISCOVERY_RUN_TIME);
    }

    stopScanning() {
        if (this.attachedDiscoverCall !== undefined){
            Noble.removeListener('discover', this.attachedDiscoverCall);
            this.attachedDiscoverCall = undefined;
        }
        this.log.debug("Stop Scanning?", Noble.listenerCount('discover') );
        
        if (Noble.listenerCount('discover') == 0) {
            if (this.restartTimerCall !== undefined){
                clearTimeout(this.restartTimerCall);
                this.restartTimerCall = undefined;
            }
            if (this.scanStopListener !== undefined) {
                Noble.removeListener('scanStop', this.scanStopListener);
                this.scanStopListener = undefined;
            }
            this.log.debug('Stopping Scan for Service ' + serviceUUID);
            Noble.stopScanning();
        }
    }

    // Noble Discovery
    nobleDiscovered(peripheral) {
        this.log.debug("Discovered:", peripheral.uuid, peripheral.advertisement.localName);
        const device = this.deviceWithID(peripheral.uuid);

        if (this.devices.length == 0) {
            this.stopScanning(); //its is over (forever)
            this.scanning = false;
        } else if (device !== undefined && device!==null && device.peripheral===undefined) {
            device.peripheral = peripheral; 
            device.discovered = true;               
            this.log.info("Found new Device ", peripheral.advertisement.localName);

            if (this.allDiscovered()){
                this.stopScanning();
                this.scanning = false;
            }
            this.startConnection(device);
        } else if (device !== undefined && device!==null) {
                this.log.info("Lost device " + device.id + " reappeared!");
                device.peripheral = peripheral;
                device.discovered = true;
                if (device.peripheral.state != "connected") {
                    if (this.allDiscovered()){
                        this.stopScanning();
                        this.scanning = false;
                    }
                    this.startConnection(device);
                } else {
                    this.log.error("    ... Undefined state");
                }
        } else {
            this.log.debug("    ... Ignoring");
        }
    }
}

      module.exports = function(log, devices, callback){     
        if (devices.length == 0) return undefined;
        const ble = new BluetoothClient(log, devices, callback);            
        return ble;
    }