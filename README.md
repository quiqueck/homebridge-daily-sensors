# homebridge-daily-sensors
This programable switch can be triggered based on userdefine rules related to time, daily events, sun elevation
or amount of ambient light. Each trigger can be randomized to make sure that the rules trigger at sloghtly different times each day.

## How does it work?
The plugin calculates typical sun events as well as the suns elevation based on a given location.

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