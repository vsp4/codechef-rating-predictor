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
var cachecollection;

function getCachedResponseUser(user, func, usecache, trycount)
{
	cachecollection.findOne({contest: contestid, user: user}, function(err, res)
	{
		if (res && usecache)
		{
			var jsonobj = res.data;
			func(jsonobj);
		}
		else
		{
			var url = util.format('https://www.codechef.com/users/%s', user);
			execHttps(url, function(source)
			{
				var doupdate = true;

				if (source.indexOf("date_versus_rating") == -1)
				{
					if (source.indexOf("Could not find page you requested for") != -1)
					{
						//codechef bug
						//continue on
						doupdate = false;
						console.log("Error in parsing user page, codechef user " + user);
					}
					else
					{
						if (trycount == 0)
						{
							doupdate = false;
							console.log("Error in cached response, Exceeded try counts " + user);
						}
						else
						{
							//bad response
							getCachedResponseUser(user, func, usecache, trycount-1);
							return;
						}
					}
				}
				
				var jsonobj = {};
				
				for (var i in parseTypes)
				{
					var search = "\"" + parseTypes[i] + "\":[";
					var index = source.indexOf(search);
					
					if (index != -1)
					{
						index += search.length;
						var endindex = source.indexOf("]", index);
						jsonobj[parseTypes[i]] = JSON.parse(source.substring(index, endindex));
					}
					else
					{
						jsonobj[parseTypes[i]] = {};
					}
				}

				if (doupdate)
				{
					cachecollection.update({contest: contestid, user: user}, {contest: contestid, user: user, data: jsonobj}, {upsert: true}, function()
					{
						func(jsonobj);
					});
				}
				else
				{
					func(jsonobj);
				}
			}, 4);
		}
	});
}

var time = 0;

function getVolatility(userdata, callback, retry)
{
	retry = (typeof retry === 'undefined') ? true : retry;

	getCachedResponseUser(userdata.user, function(obj)
	{
		var volObj = {};
		var timesObj = {};
		var lastAllRatingObj = {};
		var currentRatingObj = {};
		var isempty = true;

		for (var i in parseTypes)
		{
			var timesPlayed = 0;
			var Ra = 1500;
			var Va = 125;

			for (var j in obj[parseTypes[i]])
			{
				var currContest = obj[parseTypes[i]][j];

				if (currContest.code == contestid)
				{
					currentRatingObj[parseTypes[i]] = parseInt(currContest.rating);
					break;
				}

				if (currContest.code == "")
				{
					//stupid late bug
					continue;
				}
				
				isempty = false;
				
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
			rankData[userdata.user] = {rank: lastRank, handle: userdata.user};
		}
		else
		{
			if ((rankData[userdata.user].oldrating > 0) && (rankData[userdata.user].oldrating != 1500) && isempty && retry)
			{
				console.log("Mismatch, need to recalculate", userdata.user, rankData[userdata.user].oldrating);
				getVolatility(userdata, callback, false);
				return;
			}
		}

		rankData[userdata.user].rating = lastAllRatingObj;
		rankData[userdata.user].volatility = volObj;
		rankData[userdata.user].times = timesObj;

		//console.log("Volatility generated for ", userdata.user);
		
		setImmediate(callback);
	}, retry, 2);
}

function generateVolatility(callback)
{
	usercollection.find({contestid: contestid}).toArray(function(err, data)
	{
		console.log("Generating volatility", new Date().toString());

		async.eachLimit(data, 5, getVolatility, function(err)
		{
			if (err)
			{
				console.log("ERROR Volatility generation: " + err);
			}
			callback();
		});
	});
}

function generateRanklist(contestid, pageno, func)
{
	var url = util.format('https://www.codechef.com/api/rankings/%s?sortBy=user_handle&order=asc&page=%s&itemsPerPage=100', contestid, pageno);;
	
	/*
	//for debugging
	var filepath = path.resolve(path.join(cacheDir, pageno + ".json"));
	if (fs.existsSync(filepath))
	{
		var source = fs.readFileSync(filepath).toString();

		var obj = JSON.parse(source);
			
		obj.list.forEach(function(data)
		{
			rankData[data.user_handle] = {rank: data.rank, handle: data.user_handle, oldrating: data.rating};
			try
			{
				usercollection.insert({contestid: contestid, user: data.user_handle});
			}
			catch (ex)
			{
			}
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
	}
	else
	{
		//fs.writeFile(filepath, source, 'utf8');
	}
	*/
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
			rankData[data.user_handle] = {rank: data.rank, handle: data.user_handle, oldrating: data.rating};
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

	console.log("Calculating rating", new Date().toString());

	var rankKeys = Object.keys(rankData);
	var log4 = Math.log(4);

	async.each(parseTypes, function(type, cbnext)
	{
		var beforemeasure = new Date();

		console.log("Calculating rating", contestid, type, new Date().toString());

		var readabletype = type.replace("date_versus_rating_", "");

		var countRank = new Array(N+5).fill(0);
		var VASquaresum = 0;
		var ratingSum = 0;

		rankKeys.forEach(function(key)
		{
			countRank[rankData[key].rank]++;
			VASquaresum += rankData[key].volatility[type]*rankData[key].volatility[type];
			ratingSum += rankData[key].rating[type];
		});

		var Ravg = ratingSum/N;
		var ratingDiffSquare = 0;
		
		rankKeys.forEach(function(key)
		{
			ratingDiffSquare += (rankData[key].rating[type] - Ravg)*(rankData[key].rating[type] - Ravg);
		});

		var Cf = Math.sqrt(VASquaresum/N + ratingDiffSquare/(N-1));

		var dataInsertions = [];

		var RVList = [];

		for (var i = 0; i < rankKeys.length; i++)
		{
			var Vb = rankData[rankKeys[i]].volatility[type];
			RVList[i] = [rankData[rankKeys[i]].rating[type], Vb*Vb];
		}

		async.eachLimit(rankData, 5, function(curr, nextcalculatecallback)
		{
			var Ra = curr.rating[type];
			var RWa = (0.4*curr.times[type] + 0.2)/(0.7*curr.times[type] + 0.6);
			var Va = curr.volatility[type];
			
			var add = countRank[curr.rank]/2;

			var APerf = Math.log(N/(curr.rank - 1 + add) - 1)/log4;
			
			if (curr.rank == 1)
			{
				add = 1/2;
			}

			var EPerf = 0;

			var VaSq = Va*Va;

			RVList.forEach(function(key)
			{
				//var Rb = key[0]; //rankData[key].rating[type];
				//var Vb = key[1]; //rankData[key].volatility[type];
				EPerf += 1/(1 + Math.pow(4, (Ra - key[0])/Math.sqrt(VaSq + key[1])));
			});
			
			//var tEPerf = Math.log(N/EPerf - 1)/Math.log(4);

			var ECPerf = Math.log((N/(curr.rank - 1 + add) - 1)/(N/EPerf - 1));                          

			var NRa = Ra + ECPerf*Cf*RWa/log4;

			var maxChange = 100 + 75/(curr.times[type] + 1) + (100*500)/(Math.abs(Ra - 1500) + 500);

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
				console.log(N, curr.rank, add, maxChange, Ra, tempPerf, Cf, RWa, countRank[curr.rank]);
			}

			var data = {
				contest: contestid,
				type: readabletype,
				user: curr.handle
			};
			data.rank = curr.rank;
			data.previous = curr.rating[type];
			data.rating = NRa;

			dataInsertions.push(data);

			setImmediate(nextcalculatecallback);
			
			/*
			Debugging
			if (originalData[curr.handle][type] != undefined)
			{
				console.log(curr.handle, curr.rating[type], Math.ceil(NRa), originalData[curr.handle][type], Math.abs(originalData[curr.handle][type] - Math.ceil(NRa)));
			}
			else
			{
				console.log(user, curr.rank, maxChange, NRa, Ra, ECPerf, RWa);
			}
			*/
		},
		function(err)
		{
			datacollection.deleteMany({contest: contestid, type: readabletype}, function(err)
			{
				console.log("Deleted previous records for ", contestid, readabletype);

				if (dataInsertions.length > 0)
				{
					datacollection.insertMany(dataInsertions, function(err)
					{
						console.log("Inserted new records for ", contestid, readabletype);

						var aftermeasure = new Date();

						time += aftermeasure - beforemeasure;
						console.log(beforemeasure.toString(), aftermeasure.toString());

						setImmediate(cbnext);
					});
				}
				else
				{
						console.log("Empty records for ", contestid, readabletype);
						setImmediate(cbnext);
				}
			});
		});
	}, 
	function(err)
	{
		lastupdatecollection.update({contest: contestid}, {contest: contestid, date: new Date()}, {upsert: true}, function()
		{
			setImmediate(callback);
		});
	});
}

require("./helper.js")();

module.exports = function(nextcall)
{
	MongoClient.connect(mongourl, function(err, db)
	{
		if (err)
		{
			throw err;
		}

		/*
		if (!fs.existsSync(cacheDir))
		{
			fs.mkdirSync(cacheDir);
		}
		*/

		usercollection = db.collection("user");
		datacollection = db.collection("data");
		lastupdatecollection = db.collection("lastupdate");
		cachecollection = db.collection("cache");

		var contestLists = [];

		var processContests = function()
		{
			time = 0;

			async.eachSeries(contestLists, function(ciid, callback)
			{
				rankData = {};
				originalData = {};
				lastRank = 0;
				contestid = ciid.contest;
				parseTypes = ciid.parse;

				/*
				if (!fs.existsSync(path.join(cacheDir, contestid)))
				{
					fs.mkdirSync(path.join(cacheDir, contestid));
				}
				*/

				generateRanklist(contestid, 1, function()
				{
					lastRank = Object.keys(rankData).length + 1;
					generateVolatility(function()
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
				console.log("Completed ALL", time);

				setImmediate(nextcall);
			});
		};

		db.collection("checklist").find({}).toArray(function(err, cdatas)
		{
			cdatas.forEach(function(x)
			{
				contestLists.push(x);
			});

			processContests();
		});

	});
};
