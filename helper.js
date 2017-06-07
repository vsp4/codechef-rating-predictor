var http = require("http");
var https = require("https");

module.exports = function()
{
    this.execHttps = function (url, func, retry)
    {
        console.log("Parsing", url, retry);
        https.get(url, function(res)
        {
            res.setEncoding("utf8");
            
            var source = "";
            res.on("data", function(data)
            {
                source += data;
            });
            
            res.on("end", function()
            {
                if (source.indexOf("Server cannot process your request") != -1)
                {
                    if (retry == 0)
                    {
                        func("");
                    }
                    else
                    {
                        //bad server
                        execHttps(url, func, retry-1);
                    }
                }
                else
                {
                    func(source);                
                }
            });
        });
    }

    this.MongoClient = require('mongodb').MongoClient;
    this.mongourl = "mongodb://localhost:27017/codechefratingpredictor";

    //openshift configuration
    if (process.env.MONGODB_PASSWORD)
    {
        this.mongourl = "mongodb://" + process.env.MONGODB_USER + ":" +  process.env.MONGODB_PASSWORD
        + "@" + process.env.MONGODB_SERVICE_HOST + ':' +  process.env.MONGODB_SERVICE_PORT 
        + '/' + process.env.MONGODB_DATABASE;
    }

};
