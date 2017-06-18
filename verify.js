var http = require("http");
var https = require("https");
var util = require("util");
var cheerio = require("cheerio");
var async = require("async");
var path = require("path");
var fs = require("fs");

var dataList = {};
var originalList = {};

var cacheDir = "cache";

require("./helper.js")();

var type = "all";

function grabPage(pageno, callback)
{
    var url = "https://www.codechef.com/api/ratings/" + type + "?sortBy=global_rank&order=asc&itemsPerPage=40&page=" + pageno;
	var filepath = path.resolve(path.join(cacheDir, pageno + ".json"));

    execHttps(url, function(source)
    {
        if (source.indexOf("availablePages") == -1)
        {
            grabPage(pageno, callback);
            return;
        }
		
        fs.writeFile(filepath, source, 'utf8');
        setImmediate(callback);
    }, 4);
}

function readPage(pageno, callback)
{
    var filepath = path.resolve(path.join(cacheDir, pageno + ".json"));
	var source = fs.readFileSync(filepath).toString();

    var obj = JSON.parse(source);
    
    obj.list.forEach(function(data)
    {
        originalList[data.username] = parseInt(data.all_rating);
    });

    setImmediate(callback);
}

function savePages(start, end, callback)
{
    var arr = [];
    for (var i = start; i <= end; i++)
    {
        arr.push(i);
    }

    async.eachLimit(arr, 5, grabPage, function(err)
    {
        setImmediate(callback);
    });
}

function getMatching(url, start, end, callback)
{
	var url = util.format(url);
	execHttps(url, function(source)
	{
		var $ = cheerio.load(source);
		var lastpage = parseInt($('.pageinfo').text().split(' ')[2]) - 1;		
		
		$('tbody>tr').each(function(i, data)
		{
            var username = $($(data).children()[1]).text();
            var predicted = parseInt($($(data).children()[3]).text());
            dataList[username] = {user: username, predicted: predicted};
		});

        var arr = [];
        for (var i = start; i <= end; i++)
        {
            arr.push(i);
        }

        async.eachLimit(arr, 5, readPage, function(err)
        {
            var limit = 5000;
            var countError = new Array(limit).fill(0);

            Object.keys(dataList).forEach(function(username)
            {
                var diff = Math.abs(dataList[username].predicted - originalList[username]);
                if (diff != undefined)
                {
                    countError[diff]++;
                }
                console.log(username, dataList[username].predicted, originalList[username], diff);
            });

            for (var i = 0; i < limit; i++)
            {
                if (countError[i])
                {
                    console.log(i, countError[i]);
                }
            }
        });
	}, 4);
}

//savePages(1, 1003);
getMatching("http://127.0.0.1:8080/contest/JUNE17/all", 1, 1003);