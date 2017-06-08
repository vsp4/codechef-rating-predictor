var http = require("http");
var https = require("https");
var util = require("util");
var cheerio = require("cheerio");
var fs = require("fs");
var path = require("path");
var async = require("async");

var cacheDir = "cache";
var parseTypes = ["date_versus_rating_all", "date_versus_rating_long", "date_versus_rating_short", "date_versus_rating_ltime"]; //date_versus_rating_all"];//, "date_versus_rating_long", "date_versus_rating_short", "date_versus_rating_ltime"];

var rankData = {};
var originalData = {};
var lastRank;

var contestid;

var usercollection;
var datacollection;
var lastupdatecollection;

function getCachedResponseUser(user, func)
{
	var filepath = path.resolve(path.join(cacheDir, contestid, user + ".json"));
	//if (fs.existsSync(filepath))

	try
	{
		var jsonobj = JSON.parse(fs.readFileSync(filepath).toString());
		func(jsonobj);
	}
	catch (ex)
	{
		var url = util.format('https://www.codechef.com/users/%s', user);
		execHttps(url, function(source)
		{
			if (source.indexOf("date_versus_rating_all") == -1)
			{
				//bad response
				getCachedResponseUser(user, func);
				return;
			}
				
			var jsonobj = {};
			
			for (var i in parseTypes)
			{
				var search = "var " + parseTypes[i] + " = ";
				var index = source.indexOf(search);
				
				if (index != -1)
				{
					index += search.length;
					var endindex = source.indexOf(";", index);
					jsonobj[parseTypes[i]] = JSON.parse(source.substring(index, endindex));
				}
				else
				{
					jsonobj[parseTypes[i]] = {};
				}
			}

			fs.writeFile(filepath, JSON.stringify(jsonobj), 'utf8', function(err)
			{
				if (err)
					console.dir("ERROR: ", err);
			});

			func(jsonobj);
		}, 4);
	}
}

function getVolatility(userdata, callback)
{
	getCachedResponseUser(userdata.user, function(obj)
	{
		var volObj = {};
		var timesObj = {};
		var lastAllRatingObj = {};
		var currentRatingObj = {};

		for (var i in parseTypes)
		{
			var timesPlayed = 0;
			var Ra = 1500;
			var Va = 125;

			for (var j in obj[parseTypes[i]])
			{
				var currContest = obj[parseTypes[i]][j];
				if (currContest.code == userdata.contestid)
				{
					currentRatingObj[parseTypes[i]] = parseInt(currContest.rating);
					break;
				}

				if (currContest.code == "")
				{
					//stupid late bug
					continue;
				}
				
				var VWa = (0.5*timesPlayed + 0.8)/(timesPlayed + 0.6);
				var NRa = parseInt(currContest.rating);

				Va = Math.sqrt(1.0*(VWa*(NRa - Ra)*(NRa - Ra) + Va*Va)/(VWa + 1.1));
				Ra = parseInt(NRa);
				timesPlayed++;
									
				Va = Math.max(Va, 75);
				Va = Math.min(Va, 200);
			}

			lastAllRatingObj[parseTypes[i]] = Ra;
			volObj[parseTypes[i]] = Va;
			timesObj[parseTypes[i]] = timesPlayed;
		}

		originalData[userdata.user] = currentRatingObj;
		
		if (!(userdata.user in rankData))
		{
			rankData[userdata.user] = {rank: lastRank};
		}

		rankData[userdata.user].rating = lastAllRatingObj;
		rankData[userdata.user].volatility = volObj;
		rankData[userdata.user].times = timesObj;

		/*
		nvm, the data on ranking page is useless
		check for mismatch
		if (false)
		{
			console.log("ERROR: Rating mismatch!!", userdata.user, rankData[userdata.user], lastAllRatingObj["date_versus_rating_all"], obj);
		}
		*/

		console.log("Volatility generated for ", userdata.user);
		
		setImmediate(callback);
	});
}

function generateVolatility(contestid, callback)
{
	usercollection.find({contestid: contestid}).toArray(function(err, data)
	{
		async.eachLimit(data, 10, getVolatility, function(err)
		{
			if (err)
			{
				console.dir("ERROR: " + err);
			}

			callback();
		});
	});
}

function generateRanklist(contestid, pageno, func)
{
	var url = util.format('https://www.codechef.com/api/rankings/%s?sortBy=rank&order=asc&page=%s&itemsPerPage=100', contestid, pageno);;
	execHttps(url, function(source)
	{
		if (source.indexOf("availablePages") == -1)
		{
			generateRanklist(contestid, pageno, func);
			return;
		}

		var obj = JSON.parse(source);
		
		obj.list.forEach(function(data)
		{
			rankData[data.user_handle] = {rank: data.rank, rating: data.rating};

			try
			{
				usercollection.insert({contestid: contestid, user: data.user_handle});
			}
			catch (ex)
			{
			}
			//console.log(data.user_handle, data.rank, data.rating);
		});

		var lastpage = obj.availablePages;
		
		if (pageno < lastpage)
		{
			setImmediate(generateRanklist, contestid, pageno+1, func);
		}
		else
		{
			func();
		}
	}, 4);
}

function calculateRating(callback)
{
	var N = Object.keys(rankData).length;

	async.each(parseTypes, function(type, cbnext)
	{
		var readabletype = type.replace("date_versus_rating_", "");

		var countRank = new Array(lastRank+1).fill(0);
		var VASquaresum = 0;
		var ratingSum = 0;

		Object.keys(rankData).forEach(function(key)
		{
			countRank[rankData[key].rank]++;
			VASquaresum += rankData[key].volatility[type]*rankData[key].volatility[type];
			ratingSum += parseInt(rankData[key].rating[type]);
		});

		var Ravg = ratingSum/N;
		var ratingDiffSquare = 0;
		
		Object.keys(rankData).forEach(function(key)
		{
			ratingDiffSquare += (rankData[key].rating[type] - Ravg)*(rankData[key].rating[type] - Ravg);
		});

		var Cf = Math.sqrt(VASquaresum/N + ratingDiffSquare/(N-1));

		var dataInsertions = [];

		Object.keys(rankData).forEach(function(user)
		{
			var curr = rankData[user];
			var Ra = parseInt(curr.rating[type]);
			var RWa = (0.4*curr.times[type] + 0.2)/(0.7*curr.times[type] + 0.6);
			var Va = curr.volatility[type];
			
			var add = countRank[curr.rank]/2;

			var APerf = Math.log(N/(curr.rank - 1 + add) - 1)/Math.log(4);
			
			if (curr.rank == 1)
			{
				add = 1/2;
			}

			var EPerf = 0;

			Object.keys(rankData).forEach(function(key)
			{
				var Rb = parseInt(rankData[key].rating[type]);
				var Vb = rankData[key].volatility[type];
				EPerf += 1/(1 + Math.pow(4, (Ra - Rb)/Math.sqrt(Va*Va + Vb*Vb)));
			});

			var tEPerf = Math.log(N/EPerf - 1)/Math.log(4);

			var tempPerf = Math.log((N/(curr.rank - 1 + add) - 1)/(N/EPerf - 1));                          

			var NRa = Ra + tempPerf*Cf*RWa/Math.log(4);

			var maxChange = 100 + 75/(curr.times[type] + 1) + (100*500)/(Math.abs(Ra - 1500) + 500);

			//NRa = Math.ceil(NRa);

			if (Math.abs(NRa - Ra) > maxChange)
			{
				if (NRa > Ra)
				{
					NRa = Ra + maxChange;
				}
				else
				{
					NRa = Ra - maxChange;
				}
			}

			NRa = Math.ceil(NRa);

			if (isNaN(NRa))
			{
				console.log(N, curr.rank, add);
			}

			var data = {
				contest: contestid,
				type: readabletype,
				user: user
			};
			data.rank = curr.rank;
			data.previous = curr.rating[type];
			data.rating = NRa;

			dataInsertions.push(data);

			if (originalData[user][type] != undefined)
			{
				console.log(user, curr.rating[type], Math.ceil(NRa), originalData[user][type], Math.abs(originalData[user][type] - Math.ceil(NRa)));
			}
			else
			{
				console.log(user, curr.rank, maxChange, NRa, Ra, tempPerf, RWa);
			}
		});

		datacollection.deleteMany({contest: contestid, type: readabletype}, function(err)
		{
			console.log("Delted previous records for ", contestid, readabletype);
			datacollection.insertMany(dataInsertions, function(err)
			{
				console.log("Inserted new records for ", contestid, readabletype);
				cbnext();
			});
		});
	}, 
	function(err)
	{
		lastupdatecollection.update({contest: contestid}, {contest: contestid, date: new Date()}, {upsert: true});
		callback();
	});
}

require("./helper.js")();

module.exports = function()
{
	
	var contestIDS = [];

	/*
	//input from command line
	for (var i = 2; i < process.argv.length; i++)
	{
		contestIDS.push(process.argv[i]);
	}
	*/

	MongoClient.connect(mongourl, function(err, db)
	{
		if (err)
		{
			throw err;
		}

		if (!fs.existsSync(cacheDir))
		{
			fs.mkdirSync(cacheDir);
		}

		usercollection = db.collection("user");
		datacollection = db.collection("data");
		lastupdatecollection = db.collection("lastupdate");

		var processContests = function()
		{
			async.eachLimit(contestIDS, 1, function(ciid, callback)
			{
				rankData = {};
				originalData = {};
				lastRank = 0;
				contestid = ciid;

				if (!fs.existsSync(path.join(cacheDir, contestid)))
				{
					fs.mkdirSync(path.join(cacheDir, contestid));
				}

				generateRanklist(contestid, 1, function()
				{
					lastRank = Object.keys(rankData).length + 1;
					generateVolatility(contestid, function()
					{
						calculateRating(function()
						{
							console.log("Completed", contestid);
							callback();
						});
					});
				});
			},
			function (err)
			{
				if (err)
					console.log("Error", err);

				db.close();
				console.log("Completed ALL");
			});
		};

		db.collection("checklist").find({}).toArray(function(err, cdatas)
		{
			cdatas.forEach(function(x)
			{
				contestIDS.push(x.contest);
			});

			processContests();
		});

	});
};