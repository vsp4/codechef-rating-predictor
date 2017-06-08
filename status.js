var http = require("http");
var https = require("https");
var util = require("util");
var cheerio = require("cheerio");
var async = require("async");

var contestid;

var usercollection;
var collection;

function parseUserContest(code, funcproblem, callback)
{
	var url = "https://www.codechef.com/api/contests/" + code;
	execHttps(url, function(source)
	{
		if (source.indexOf('"status":"success"') == -1)
		{
			parseUserContest(code, func);
			return;
		}

		var obj = JSON.parse(source);
		
		async.each(obj.problems, funcproblem, function(err)
		{
			if (err)
				throw err;

			callback();
		});

	}, 3);
} 

function parseStatusPage(contestid, problemid, pageno, callback)
{
	var url = util.format('https://www.codechef.com/%s/status/%s?page=%s&sort_by=Date%2FTime&sorting_order=asc', contestid, problemid, pageno);;
	execHttps(url, function(source)
	{
		if (source.indexOf("pageinfo") == -1)
		{
			parseStatusPage(contestid, problemid, pageno, callback);
			return;
		}

		var $ = cheerio.load(source);
		var lastpage = parseInt($('.pageinfo').text().split(' ')[2]) - 1;		
		
		$('table[class="dataTable"]>tbody>tr>td>a').each(function(i, data)
		{
			var username = $(data).attr('title');
			try
			{
				usercollection.insert({contestid: contestid, user: username});
			}
			catch (ex)
			{
			}
		});

		collection.update({problemid: problemid}, {$set: {pagedone: pageno}}, {upsert: true});
		
		console.log("Current page", pageno, lastpage, url, $('.pageinfo').text());
	
		if (pageno < lastpage)
		{
			parseStatusPage(contestid, problemid, pageno+1, callback);
		}
		else
		{
			callback();
		}
	}, 4);
}

require("./helper.js")();

module.exports = function(nextcall)
{
	
	var contestIDS = [];

	MongoClient.connect(mongourl, function(err, db)
	{
		if (err)
		{
			throw err;
		}

		collection = db.collection("status");
		usercollection = db.collection("user");	

		usercollection.createIndex({contestid: 1, user: 1}, {unique: true });

		/*
		bad way
		if (process.argv.length >= 4 && process.argv[3] == 'delete')
		{
			//reset before use
			usercollection.deleteMany({});
			collection.deleteMany({});
		}
		*/

		var processContests = function()
		{
			async.eachLimit(contestIDS, 1, function(ciid, callback)
			{
				contestid = ciid;
				
				parseUserContest(contestid, function(problem, callback)
				{
					var problemid = problem.code;
					collection.findOne({problemid: problemid}, function(err, obj)
					{
						var lastpage = (obj !== null ? obj.pagedone : 0);
						console.log(problemid, lastpage);
						parseStatusPage(contestid, problemid, lastpage, callback);
					});
				},
				function()
				{
					console.log("Completed parsing", contestid);
					callback();
				});
			},
			function (err)
			{
				if (err)
					console.log("Error", err);

				db.close();
				console.log("Completed ALL");

				nextcall();
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