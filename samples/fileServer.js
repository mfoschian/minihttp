var minihttp = require('../minihttp');
var util = require('util');
//var fsPath = require("path");

console.log( util.inspect(process.argv) );
//var APP_DIRNAME = fsPath.dirname(require.main.filename);
//console.log( APP_DIRNAME );
//console.log( util.inspect(require.main) );

var options =
{
	webHome: '', // default 'public',
	port: 8080
};

if( process.argv[2] )
{
	options.wwwroot = process.argv[2];
	console.log( 'wwwroot is '+options.wwwroot );
}


var Server = new minihttp.HttpServer( options );


Server.route('/', function( request, response, parms )
{
	Server.sendResponse( response, Server );
});

Server.listen();

