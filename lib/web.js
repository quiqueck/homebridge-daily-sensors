'use strict';
const moment = require('moment'),
      packageJSON = require("../package.json"),
      express = require('express'),
      path = require('path'),
      fs = require('fs'),
      $ = require('./helpers.js');

var WebServers = {};
var WebPaths = {};
var Characteristic;
exports.setCharacteristics = function(c) {
    Characteristic = c;    
}

exports.startServerForSensor = function(sensor){
    if (sensor.port > 0) {
        const port = sensor.port;
        sensor.log.debug(`Starting HTTP listener on port ${port} for path ${sensor.webPath}...`);

        var expressApp = WebServers[sensor.port];
        var masterForPort = false;
        if (expressApp === undefined) {
            masterForPort = true;
            expressApp = express();
            expressApp.listen(port, (err) =>
            {
                if (err) {
                    sensor.log.error(`Failed to start Express on port ${port}!`, err);
                } else {
                    sensor.log.debug(`Express is running on port ${port}.`)
                }
            });

            WebServers[sensor.port] = expressApp;
        }

        //get list of available paths on a port
        var paths = WebPaths[sensor.port];
        if (paths === undefined){
            paths = [];
            WebPaths[sensor.port] = paths;
        }
        paths.push({
            path:sensor.webPath,
            name:sensor.config.name,
            object:sensor
        })

        expressApp.get(sensor.webPath+"/bt/restartDiscover", (request, response) => {
            sensor.restartDiscovery();
            response.json({
                operation:'bt/restartDiscover',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            sensor.log.debug("received bt/restartDiscover");
        });
        
        expressApp.get(sensor.webPath+"/0", (request, response) => {
            sensor.override = 0;
            sensor.syncSwitchState();           
            response.json({
                operation:'off',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            sensor.log.debug("received OFF");
        });
        expressApp.get(sensor.webPath+"/1", (request, response) => {
            sensor.override = 1;
            sensor.syncSwitchState();          
            response.json({
                operation:'on',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            sensor.log.debug("received ON");
        });
        expressApp.get(sensor.webPath+"/2", (request, response) => {
            sensor.override = 2;
            sensor.syncSwitchState();          
            response.json({
                operation:'long',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            sensor.log.debug("received LONG");
        });
        expressApp.get(sensor.webPath+"/clear", (request, response) => {
            sensor.override = undefined;
            sensor.syncSwitchState();  

            response.json({
                operation:'clear',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            sensor.log.debug("received CLEAR");
        });
        expressApp.get(sensor.webPath+"/state", (request, response) => {
            response.json(JSONCommonResponse(sensor, request));
            sensor.log.debug("received STATE");
        });
        expressApp.get(new RegExp(sensor.webPath+"/trigger/(\\d\\d?\\d?)?(/(\\d\\d?))?"), (request, response) => {            
            const nr = request.params[0];            
            if (nr!==undefined) {
                if (nr >= 0 && nr<sensor.triggers.length) {
                    response.json({
                        operation:'trigger.info',
                        nr:nr,
                        ok:true,                        
                        ...triggerRanges(sensor, sensor.triggers[nr], sensor.triggers.slice(0, nr+1), request.params[2] )
                    });
                } else {
                    response.json({operation:'trigger.info', nr:nr, ok:false, err:'Invalid Index'})
                }
            } else {
                response.json({
                    operation:'trigger.list',
                    ok:true,
                    count:sensor.triggers.length,
                    triggers:sensor.triggers.map(t => {name:$.formatTrigger(t)})
                });
            }
            sensor.log.debug("received STATE");
        });
        expressApp.get(sensor.webPath+"/reload", (request, response) => {
            sensor.fetchEvents(new Date());
            response.json({
                operation:'reload',
                ok:true,
                ...JSONCommonResponse(sensor, request)
            });
            sensor.logug.deb("received STATE");
        });
        expressApp.get(sensor.webPath+"/", (request, response) => {               
            response.send(buildInfoHTML(sensor));
        }); 

        if (masterForPort) {
            expressApp.get("/js/d3.js", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/d3.v5.min.js'));           
            }); 
            expressApp.get("/js/jquery.min.js", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/jquery-3.3.1.min.js'));           
            }); 
            expressApp.get("/js/bootstrap.min.js", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/bootstrap.min.js'));           
            });
            expressApp.get("/css/bootstrap.min.css", (request, response) => {               
                response.sendFile(path.join(__dirname, '../css/bootstrap.min.css'));           
            }); 
            expressApp.get("/css/style.css", (request, response) => {               
                response.sendFile(path.join(__dirname, '../css/style.css'));           
            });
            expressApp.get("/js/bootstrap.min.js.map", (request, response) => {               
                response.sendFile(path.join(__dirname, '../js/bootstrap.min.js.map'));           
            });  
            
            expressApp.get("/css/bootstrap.min.css.map", (request, response) => {               
                response.sendFile(path.join(__dirname, '../css/bootstrap.min.css.map'));           
            }); 
            expressApp.get("/", (request, response) => {               
                response.send(buildIndexHTML(sensor));           
            }); 
            expressApp.get("/accessories", (request, response) => {   
                var json = {
                    host:request.headers.host,
                    accessories:[]
                }
                WebPaths[sensor.port].forEach(path => {
                    json.accessories.push({
                        path:path.path,
                        name:path.name,
                        info:JSONCommonResponse(path.object, request)
                    });
                });
                response.json(json);           
            });
        }
        sensor.log.info("HTTP listener started on port " + port + "  for path " + sensor.webPath + ".");
    }
}

function JSONCommonResponse(sensor, request) {
    const ovr = sensor.override === undefined ? undefined : {
        forced:sensor.override,
        actual:sensor.isActive
    };
    return {
        accessory:{
            name : sensor.config.name,
            host : request.headers.host,                        
            path : sensor.webPath
        },
        bluetoothSwitch : sensor.bluetooth,
        activeState:sensor.getIsActive(),
        homebridgeState:sensor.currentSwitchValue == Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS ? false : (sensor.currentSwitchValue == Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS ? true : undefined),
        override:ovr,
        fixedConfig:sensor.fixedConfig
    }
}

function buildIndexHTML(sensor){        
    let s = fs.readFileSync(path.join(__dirname, '../index.html'), { encoding: 'utf8' });

    s = s.replace('\{\{VERSION\}\}', packageJSON.version);
    return s;
}

function buildInfoHTML(sensor){
    function formatState(state, bold){
        if (bold===undefined) bold=true;
        let s = '<'+(bold?'b':'span')+' style="color:'+(state?'green':'red')+'">';
        s += (state?'ON':'OFF');
        s += '</'+(bold?'b':'span')+'>';
        return s;
    }
    const start = moment({h: 0, m: 0, s: 1})

    const minutes = 1;
    let offset = 0;
    let p = 0;

    let conditionData = [{data:[], name:'Daystart'}, {data:[], name:'Daystart'}];
    sensor.triggers.forEach(trigger => {
        conditionData[2*trigger.id] = {
            data:[],
            name:$.formatTrigger(trigger)
        }
        conditionData[2*trigger.id+1] = {
            data:[],
            name:"Result after " + $.formatTrigger(trigger)
        }
    });

    let data = [
        {data:[], min:-1, max:+1, name:'active', blocky:true},
        {data:[], min:-90, max:90, name:'altitude', blocky:false},
        {data:[], min:0, max:100000, name:'lux', blocky:false}];

    let eventList = {data:[]};        
    sensor.events.forEach(event => {
        eventList.data.push({
            date:event.when,
            name:$.triggerEventName($.EventTypes[event.event]),
            value:(180*event.pos.altitude/Math.PI) / 90
        });
    });
                                                    

    let tableHTML = '';  
    const self = sensor; 
    const dayStart =  sensor.dayStart;     

    while (offset < 60*24) {
        const mom = start.add(minutes, 'minutes');            
        const when = mom.toDate();
        const obj = sensor.testIfActive(when);
        
        sensor.log.debug(when, obj.active);

        conditionData[0].data[p] = {
            date : mom.toDate(),
            value : dayStart
        }; 
        conditionData[1].data[p] = {
            date : mom.toDate(),
            value : dayStart
        };  
        var all = dayStart;             
        sensor.triggers.forEach(trigger => {
            var item = conditionData[2*trigger.id];
            var itemAll = conditionData[2*trigger.id+1];

            var one = undefined;
            one = self.testTrigger(trigger, when, obj, one, true, true);
            all = self.testTrigger(trigger, when, obj, all, false, true);
            
            item.data[p] = {
                date : mom.toDate(),
                value : one
            };
            itemAll.data[p] = {
                date : mom.toDate(),
                value : all
            };                
        });

        data[0].data[p] = {
            date : mom.toDate(),
            value : obj.active ? 1 : 0,
            time : mom.format('LT'),
            values : [obj.active ? 0 : -1, obj.active ? 0 : 1]
        }; 
        data[1].data[p] = {
            date : mom.toDate(),
            value : 180*obj.pos.altitude/Math.PI,
            time : mom.format('LT'),
            values : [Math.min(180*obj.pos.altitude/Math.PI, 0), Math.max(180*obj.pos.altitude/Math.PI, 0)]
        };
        data[2].data[p] = {
            date : mom.toDate(),
            value : obj.lux,
            time : mom.format('LT'),
            values : [Math.min(obj.lux, 0), Math.max(obj.lux, 0)]
        };            
        offset += minutes;
        p++;

        const e = sensor.fetchEventAt(when);
        const et = $.triggerEventName(e ? $.EventTypes[e.event] : -1);
        tableHTML += '<thead class="thead-dark"><tr><th colspan="4">';
        tableHTML += mom.format('LT')+', ';
        tableHTML += $.formatRadians(obj.pos.altitude)+', ';
        tableHTML += Math.round(obj.lux) +', ';
        tableHTML += et + '</th></tr></thead>';
        tableHTML += '<tr><td></td><td>Daystart</td><td style="width:1px"> =&gt; </td><td style="width:1px;">'+formatState(dayStart)+'</td></tr>';;

        var last = dayStart;
        obj.conditions.forEach(val => {
            tableHTML += '<tr><td></td><td>';
            tableHTML += $.formatTrigger(val.trigger);
            tableHTML += '</td><td style="width:1px;white-space: nowrap;"> =&gt; ';
            switch (val.trigger.op) {
                case $.TriggerOps.and:
                    tableHTML +=  formatState(last, false) + ' and ' + formatState(val.active, false) + ' = '
                    break;
                case $.TriggerOps.or:
                    tableHTML +=  formatState(last, false) + ' or ' + formatState(val.active, false) + ' = '
                    break;
                
                case $.TriggerOps.discard:
                    tableHTML +=  '[IGNORE]' ;
                    break;
                default:
                tableHTML +=  '';
            }
            tableHTML += '</td><td style="width:1px;white-space: nowrap;">'+formatState(val.result, val.trigger.op!=$.TriggerOps.discard)+'</td></tr>';
            last = val.result;
        })
        
    }
    
    let s = fs.readFileSync(path.join(__dirname, '../template.html'), { encoding: 'utf8' });

    s = s.replace('\{\{NAME\}\}', sensor.config.name);
    s = s.replace('\{\{DATA\}\}', JSON.stringify(data));
    s = s.replace('\{\{TABLE\}\}', tableHTML);
    s = s.replace('\{\{EVENT_DATA\}\}', JSON.stringify(eventList));
    s = s.replace('\{\{CONDITION_DATA\}\}', JSON.stringify(conditionData));
    return s;
}

function triggerRanges(sensor, trigger, triggers, deltaMinutes){
    let begin = moment().startOf('day');
    const result = {        
        name:$.formatTrigger(trigger),
        begin:begin.toISOString(),
        interval: deltaMinutes,
        dayStart: sensor.dayStart,
        trigger:trigger,
        ranges:[],
        activeStates:[],
    }
    const triggerAll = {        
        ...trigger,
        when:$.TriggerWhen.both
    }

    let active = undefined;
    sensor.iterateDay((iterations, time) => {        
        const when = time.toDate();
        const pos = sensor.posForTime(when);
        const newLux = sensor.luxForTime(when, pos);
        let obj = {
            active:sensor.dayStart,
            pos:pos,
            lux:newLux,
            conditions:[]
        };

        let one = undefined;
        one = sensor.testTrigger(trigger, when, obj, one, true, true);
        let both = undefined;
        both = sensor.testTrigger(triggerAll, when, obj, both, true, true);
        let resultObject = {
            triggerResult:both,
            didTrigger:one!==undefined,
            when:time.toISOString(),
            ...sensor.testIfActive(when, triggers)
        };
        resultObject.activeState = resultObject.active;
        resultObject.active = undefined;
        resultObject.conditions = [
            {nr:-1, activeState:sensor.dayStart, triggerResult:sensor.dayStart},
            ...resultObject.conditions.map(c => { return {nr:c.trigger.id-1, triggerResult:c.active, activeState:c.result};})
        ];
        result.activeStates.push(resultObject);


        if (active !== undefined){
          //trigger state changed
          if (active != both || iterations==1) {
            if (!begin.isSame(time, 'second')) {
                const range = {
                    active:both,
                    start:begin.toISOString(),
                    end:time.toISOString(),
                    willTrigger:one!==undefined
                };
                
                result.ranges.push(range);
                begin = time.clone();
            }
          }  
        } 

        active = both;
    }, true, deltaMinutes)

    return result;
}