'use strict';
// based on the noble code from homebridge-avea-bulb

const moment = require('moment'),
      packageJSON = require("../package.json"),
      path = require('path'),
      Noble = require('noble'),
      fs = require('fs'),
      $ = require('./helpers.js'),
      bleDailySwitch = require('./bleDailySwitch.js');

var scanRestartCount = 0;
const maxScanRestarts = 5;
const DISCOVERY_RUN_TIME = 20000;
const DISCOVERY_PAUSE_TIME = 5000;
const WATCHDOG_TIMER = 23000;
const serviceUUID = '0818c2dd127641059e650d10c8e27e35';
const switchCharacteristicUUID = "3e989a753437471ea50a20a838afcce7";

class BluetoothClient {
    constructor(log, devices, callback) {
        this.log = log;
        this.callback = callback;
        this.scanning = false;
        this.ready = false;
        this.devices = devices.map(d => {return {id:d, peripheral:undefined, connected:false, discovered:false};});

        //Initialise the Noble service for talking to enabled devices
        Noble.on('stateChange', this.nobleStateChange.bind(this));
        this.scanStopListener = this.nobleScanStop.bind(this)
        Noble.on('scanStop', this.scanStopListener);
        this.watchdog();
    }

    allDiscovered(){
        return !this.devices.some(item => !item.discovered );
    }

    deviceWithID(bid){
        return this.devices.find(item => item.id == bid); 
    }

    watchdog(){
        if (this.ready && (this.attachedDiscoverCall === undefined || Noble.listenerCount('discover')==0) && !this.allDiscovered()){
            this.log.info("Watchdog restarted Discovery");
            this.attachedDiscoverCall = this.nobleDiscovered.bind(this);
            Noble.on("discover", this.attachedDiscoverCall);
            this.startScanningWithTimeout();
        }
        setTimeout(this.watchdog.bind(this), WATCHDOG_TIMER)
    }

    startConnection(device){
        bleDailySwitch.connect(this, device, serviceUUID, switchCharacteristicUUID);
    }

    // Noble State Change
    nobleStateChange (state) {
        if (state == "poweredOn") {
            this.ready = true;
            this.log.info("Starting Noble scan..");            
            
            if (this.attachedDiscoverCall === undefined) {
                this.attachedDiscoverCall = this.nobleDiscovered.bind(this);
                Noble.on("discover", this.attachedDiscoverCall);
            }

            this.startScanningWithTimeout();
            this.scanning = true;
        } else {
            this.ready = false;
            this.log.info("Noble state change to " + state + "; stopping scan.");
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
    }

    restartDiscovery(){
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

            this.restartDiscovery();
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
                self.stopScanning();
                self.scanning = false;                
            }
            this.startConnection(device);
        } else if (device !== undefined && device!==null) {
                this.log.info("Lost device " + device.id + " reappeared!");
                device.peripheral = peripheral;
                device.discovered = true;
                if (device.peripheral.state != "connected") {
                    const self = this;
                    if (this.allDiscovered()){
                        self.stopScanning();
                        self.scanning = false;                        
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