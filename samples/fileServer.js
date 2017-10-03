var minihttp = require('../minihttp');
var util = require('util');

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
	Server.sendResponse( response, "Hello World!" );
});

Server.route('/upload',
{
	post: function( request, response, parms )
	{
		var file = parms.files[0];
		if( file )
		{
			console.log( 'uploaded file %s', file.path );
			Server.sendResponse( response, "Uploaded!" );
		}
		else
		{
			console.log( 'no file sent' );
			Server.sendResponse( response, "no file sent!" );
		}
	}
});

Server.route('/crash', function( request, response, parms )
{
	throw new Error( 'Crash!' );
});

Server.listen();
