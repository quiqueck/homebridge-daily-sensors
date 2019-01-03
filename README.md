# homebridge-daily-sensors
This programable switch can be triggered based on userdefine rules related to time, daily events, sun elevation
or amount of ambient light. Each trigger can be randomized to make sure that the rules trigger at sloghtly different times each day.

## How does it work?
The plugin calculates typical sun events as well as the suns elevation based on a given location. The simulated switch can be triggered through an array of TriggerEvents and either send a single press (activated) or a double press (deactivated) once the activation state changes. 

All TriggerEvent are stored in the `trigger:array` config variable. Each TriggerEvent has the following basic properties:
- `type` : The type of the TriggerEvent (`time`, `altitude`, `lux` or `event`). 
- `value` : A given treshold that is compared 
- `active` : The new activation state of the sensor if the TriggerEvent is triggered 

The sensor receives a tick event in a certain interval (config variable `tickTimer:seconds`). At every tick, all TriggerEvents are evaluated in sequence and the state of the sensor is determined (active/deactive) like this:
- First the basic activation state is set (config variable `dayStartsActive:bool`)
- Each triggerEvent (config variable `trigger:array`) is evaluated in the given sequence. 
- If a triggerEvent is triggered, the activation state is recalculated. Normaly a TriggerEvent is triggered when the current value (like the current time) is greater than the specified `value` of the TriggerEvent and the activation state is set as was defined in the triggerEvents' `active:bool` config variable.

### Time

### Altitude

### Lux

### Event

## Simple Configuration
The following configuration is based on the suns elevation (altitude) in london. If the sun rises above 3° the switch will be triggered (with a single press (<= `active:true`)). If the sun gets below 3° it triggers a double press
```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"My new daily switch",
      "dayStartsActive":false,    
      "trigger":[{
            "active":true,
            "type":"altitude",
            "value":"0.03",
            "trigger":"both"
      }],
      "location":{
        "longitude":-0.118092,
        "latitude":51.509865
      }
  }]
```