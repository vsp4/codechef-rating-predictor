var fs = require("fs");
var processLogFile = 'process.txt';

var isWorking = false;

module.exports = function ()
{
    var processnow = false;

    if (isWorking)
    {
        processnow = false;
    }
    else if (fs.existsSync(processLogFile))
    {
        var contents = fs.readFileSync(processLogFile, 'utf8');
        var dt = new Date(contents);
        if (dt == undefined)
        {
            processnow = true;
        }
        else
        {
            var seconds = (new Date() - dt)/1000;
            if (seconds > 10*60) //10 minutes
            {
                processnow = true;
            }
        }
    }
    else
    {
        processnow = true;
    }

    if (processnow)
    {
        var dt = new Date().toString();
        fs.writeFileSync(processLogFile, dt);
        console.log("Starting process", dt);

        var status = require("./status.js");
        var generator = require("./generate.js");

        isWorking = true;

        status(function()
        {
            generator(function()
            {
                isWorking = false;
            })
        });
    }
}