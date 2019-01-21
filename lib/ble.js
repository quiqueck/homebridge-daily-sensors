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
const serviceUUID = '0818c2dd127641059e650d10c8e27e35';
const switchCharacteristicUUID = "3e989a753437471ea50a20a838afcce7";

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
        self.log.debug("will connect", device.id, device.peripheral.listeners('connect'));
        
        if (!device.peripheral.listeners('connect').some(t=>t == device.connectFunction)){
            device.peripheral.on('servicesDiscover', function(services){
                self.log.debug("Discovered Services:", services?services.length:0);
                const deviceService = services?services[0]:undefined;
                if (deviceService === undefined){
                    device.peripheral.disconnect();
                    return;
                }
                self.log.debug('Discovered DailySwitch Service on', device.peripheral.uuid);
        
                deviceService.on('characteristicsDiscover', function(characteristics){
                    self.log.debug('Discovered Characteristics', characteristics?characteristics.length:0);
                    device.switchCharacteristic = characteristics?characteristics[0]:undefined;

                    if (device.switchCharacteristic === undefined){
                        device.peripheral.disconnect();
                        return;
                    }

                    self.log.debug('Discovered DailySwitch Characteristic on', device.peripheral.uuid);
                    
                    device.switchCharacteristic.on('read', function(data) {
                        self.log.debug("Did read from", device.peripheral.uuid, data.toString());
                    });
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
                        if (error) {
                            self.log.error("Subscription Error", error);
                        }
                        self.log.debug('Subsribe on');
                    });
                });

                setTimeout(()=>{deviceService.discoverCharacteristics([switchCharacteristicUUID])}, 2000);                
            });

            //connection handler;
            device.connectFunction = (error) => {   
                if (error){
                    self.log.error("Connection Error:", error);
                    return;
                }

                device.connected = true;             
                self.log.debug('connected to peripheral: ' + device.peripheral.uuid);
                setTimeout(()=>{ device.peripheral.discoverServices([serviceUUID])}, 2000);   
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
        
        device.peripheral.connect();
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
       
        if (!this.allDiscovered() /*&& maxScanRestarts > scanRestartCount*/) {
            scanRestartCount++;
            if (this.restartTimerCall === undefined) {
                this.restartTimerCall = setTimeout(function () {
                    if (!this.allDiscovered()){
                        scanRestartCount++;
                        this.restartTimerCall = undefined;
                        this.log.debug('Restarting Discovery allFound=' + this.allDiscovered() + ', ct=' + scanRestartCount + ', where=event');
                        this.startScanningWithTimeout();
                    }
                }.bind(this), DISCOVERY_PAUSE_TIME);
            }
        } else {
            this.scanning = false;
        }
    }

    ensureScanStopNotification(){
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
    }

    startScanningWithTimeout() {
        this.ensureScanStopNotification();
        const self = this;
        this.log.info("Start Scanning for Service", serviceUUID);
        
        Noble.startScanning([serviceUUID], false, (error) => {            
            if (error) {
                this.log.error("Failed to Start Scan:", error);
            } else {
                this.log.debug("Started Scan");
            }
        });
        setTimeout(function () {
            if (Noble.listenerCount('discover') == 0) { return; }
            this.log.debug('Discovery timeout. Stopping Scan for Service ' + serviceUUID);
            this.ensureScanStopNotification();
            Noble.stopScanning();
            this.scanning = false;

            if (this.restartTimerCall === undefined) {
                this.restartTimerCall = setTimeout(function () {
                    if (!this.allDiscovered()){
                        scanRestartCount++;
                        this.restartTimerCall = undefined;
                        this.log.debug('Restarting Discovery allFound=' + this.allDiscovered() + ', ct=' + scanRestartCount + ', where=start');
                        this.startScanningWithTimeout();
                    }
                }.bind(this), DISCOVERY_PAUSE_TIME);  
            }          
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
            
            const self = this;
            if (this.allDiscovered()){
                setTimeout(() => {
                    self.stopScanning();
                    self.scanning = false;
                }, 5000);                
            }
            this.startConnection(device);
        } else if (device !== undefined && device!==null) {
                this.log.info("Lost device " + device.id + " reappeared!");
                device.peripheral = peripheral;
                device.discovered = true;
                if (device.peripheral.state != "connected") {
                    const self = this;
                    if (this.allDiscovered()){
                        setTimeout(() => {
                            self.stopScanning();
                            self.scanning = false;
                        }, 5000);                
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