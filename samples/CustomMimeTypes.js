var minihttp = require('../minihttp');
var util = require('util');

var options =
{
	webHome: '', // default 'public',
	port: 8080,
	mimeTypes: { woff2: 'application/font-woff2' }
};

if( process.argv[2] )
{
	options.wwwroot = process.argv[2];
	console.log( 'wwwroot is '+options.wwwroot );
}


var Server = new minihttp.HttpServer( options );

Server.putMimeType( 'woff', 'application/font-woff' );
Server.putMimeType( { woff3: 'application/font-woff3' } );

console.log( util.inspect( Server.config.mimeTypes ) );

Server.route('/', function( request, response, parms )
{
	Server.sendResponse( response, parms );
});

Server.listen();
