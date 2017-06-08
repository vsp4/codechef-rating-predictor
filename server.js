var http = require("http");
var https = require("https");
var util = require("util");
var cheerio = require("cheerio");
var express = require("express");
var app = express();

app.set('view engine', 'ejs');

//from snipplr
function elapsedTime (createdAt)
{
    var ageInSeconds = (new Date().getTime() - new Date(createdAt).getTime()) / 1000;
    var s = function(n) { return n == 1 ? '' : 's' };
    if (ageInSeconds < 0) {
        return 'just now';
    }
    if (ageInSeconds < 60) {
        var n = ageInSeconds;
        return n + ' second' + s(n) + ' ago';
    }
    if (ageInSeconds < 60 * 60) {
        var n = Math.floor(ageInSeconds/60);
        return n + ' minute' + s(n) + ' ago';
    }
    if (ageInSeconds < 60 * 60 * 24) {
        var n = Math.floor(ageInSeconds/60/60);
        return n + ' hour' + s(n) + ' ago';
    }
    if (ageInSeconds < 60 * 60 * 24 * 7) {
        var n = Math.floor(ageInSeconds/60/60/24);
        return n + ' day' + s(n) + ' ago';
    }
    if (ageInSeconds < 60 * 60 * 24 * 31) {
        var n = Math.floor(ageInSeconds/60/60/24/7);
        return n + ' week' + s(n) + ' ago';
    }
    if (ageInSeconds < 60 * 60 * 24 * 365) {
        var n = Math.floor(ageInSeconds/60/60/24/31);
        return n + ' month' + s(n) + ' ago';
    }
    var n = Math.floor(ageInSeconds/60/60/24/365);
    return n + ' year' + s(n) + ' ago';
}

require("./helper.js")();

MongoClient.connect(mongourl, function(err, db)
{
	if (err)
	{
		 throw err;
	}

	var datacollection = db.collection("data");
	var lastupdatecollection = db.collection("lastupdate");

	var processor = require("./process.js");

	app.get('/contest/:contestid/:type', function(req, res)
	{
		processor();

		lastupdatecollection.findOne({contest: req.params.contestid}, function (err, dateobj)
		{
			if (err)
				throw err;

			if (dateobj)
			{
				datacollection.find({contest: req.params.contestid, type: req.params.type}).sort({rank: 1}).toArray((err, result) => {
					if (err)
						throw err;
					
					for (var i in result)
					{
						result[i].change = result[i].rating - result[i].previous;
					}

					var typename = req.params.type[0].toUpperCase() + req.params.type.slice(1);

					console.log(dateobj.date);
					
					res.render('rating', {elapsed: elapsedTime(dateobj.date), contest: req.params.contestid, type: req.params.type, typename: typename, result: result});
				});
			}
			else
			{
				res.status(404);
				res.render("error", {message: "No contest predictions found for such contest!"});
			}
		});
	});

	app.use(function(req, res)
	{
		processor();
		res.status(500);
		res.render("error", {message: "Invalid link!"});
	});

	app.listen(8080);

	console.log('Listening on http://127.0.0.1:8080');
	
	processor();
	
});