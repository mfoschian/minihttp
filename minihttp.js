
var util = require('util');
var http = require("http");
var url = require("url");
var fs = require("fs");
var fsPath = require("path");
var sys = require('sys');
var formidable = require('formidable');

var DEF_HTTP_PORT = 80;


//----- UTILS {
function generateToken(pattern){
    var d = new Date().getTime();
    var uuid = pattern.replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
        return (c=='x' ? r : (r&0x7|0x8)).toString(16);
    });
    return uuid;
};

function generateUUID(){
    var pattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
	var uuid = generateToken(pattern);
    return uuid;
};



function dup(o)
{
	var d = {};
	for( var k in o )
	{
		d[k] = o[k];
	}
	return d;
}

function merge(obj, ro)
{	
	if( !obj || !ro ) return;
	for( var k in ro )
	{
		obj[k] = ro[k];
	}
}
//----- UTILS }

function HttpServer( args )
{
	this.config =
	{
		webHome: 'public',
		defaultPage: '/index.html',
		favicon: 'favicon.ico',
		uploadDir:  'upload',
		port: DEF_HTTP_PORT
	};

	merge( this.config, args );
	
	this.parsers = {};
	this.routes = [];
		
	this.callbacks = {};
	this.on = function( name, callback )
	{
		this.callbacks[name] = callback;
		return this;
	};
	this.fire = function(name, args)
	{
		var cb = this.callbacks[name];
		if( cb )
			return cb( args );
		else
			return false;
	};


	this.route = function( path, callback )
	{
		if( typeof(callback) == 'function' )
			// if not specified callback is on get method
			methods = { get: callback };
		else
			methods = callback;

		var u = url.parse( path );
		
		var ids = [];
		var r = new RegExp('{([^\/}]+)}','gi');
			
		var rpath = u.pathname.replace( r, function( match, p1 )
		{
			ids.push( p1 );
			return '([^\/]+)';
		});
		
		var rex = new RegExp( '^'+rpath+'$' );
		this.routes.push( { exp: rex, ids: ids, methods: methods } );
		
		return this;
	};
	this.get_route = function( path )
	{
		console.log('checking route for ['+path+']');

		for( var i in this.routes )
		{
			var route = this.routes[i];
			
			//console.log( '-route_check: '+route.exp+' '+typeof(route.exp) );
			
			var match = path.match( route.exp );
			if( match )
			{
				match.shift(); // ignore match string
				var ids = {};
				var r = { methods: route.methods, ids: ids };
				for( var j in route.ids )
				{
					var id = route.ids[j];
					ids[ id ] = match.shift();
				}
				//console.log( 'Matched' );
				//console.log( util.inspect(r) );
				return r;
			}
		}
		return null;
	};
		
	this.mimeTypes =
	{
		js: 'application/javascript',
		html: 'text/html',
		css : 'text/css',
		gif: 'image/gif',
		jpg: 'image/jpeg',
		png: 'image/png',
		ico: 'image/x-icon',
		json: 'application/json',
		ogg: 'application/ogg',
		mp3: 'audio/mpeg',
		txt: 'text/plain'
	};
	
	this.mimeType =  function (s)
	{
		return this.mimeTypes[ s || 'txt' ];
	}

	var me = this;

	this.JsonOK = function(info)
	{
		return JSON.stringify({ result: 'OK', data: (info || '') });
	};
	
	this.JsonERR = function(err)
	{
		return JSON.stringify({ result: 'ERR', error: (err || '') });
	};

	this.sendJSON = function( res, json, headers )
	{
		var h = {'content-type': this.mimeType('json')};
		for( var i in headers )
		{
			h[i] = headers[i];
		}
		res.writeHead(200, h);
		res.end(json);
	};

	this.sendErrorResponse = function( res, err, headers )
	{
		this.sendJSON( res, this.JsonERR(err), headers );
	};

	this.sendResponse = function( res, obj, headers )
	{
		this.sendJSON( res, this.JsonOK(obj), headers );
	};

	this.redirectToUrl = function( res, url, headers )
	{
		var h = { Location: url };
		merge( h, headers || {} );
		res.writeHead(301, h);
		res.end();
	};

	this.parse_post_parms = function( request, callback )
	{
		var fields = {};
		var files = [];
		var tmpFiles = [];
		var form = new formidable.IncomingForm();

		form.uploadDir = fsPath.resolve(__dirname, this.config.webHome + '/' + this.config.uploadDir);
		form.on('field', function(field, value)
		{
			fields[field] = value;
		})
		.on('file', function(field, file)
		{
			if( file.size == 0 )
			{
				tmpFiles.push( file.path );
			}
			else
			{
				console.log( util.inspect(file) );
				files.push(file);
			}
		})
		.on('end', function()
		{
			for( var f in tmpFiles )
			{
				try
				{
					fs.unlink( tmpFiles[f] );
				}
				catch(e)
				{
					console.log('\tError deleting file');
				}
			}
			callback( null, fields, files );
		})
		.on('error', function(err)
		{
			console.log( 'error parsing posted parms' );
			callback( err );
		});
		form.parse(request);					
	};

	this.get_cookies = function(headers)
	{
		var cookies = {};

		var cs = headers['set-cookie'] || headers['Set-Cookie'] || headers['cookie'];
		if( typeof( cs ) == "string" )
			cs = [ cs ];

		for( var i in cs )
		{
			var cc = cs[i].split(';');
			for( j in cc )
			{
				var pair = cc[j].split('=');
				cookies[ pair[0] ] = pair[1];
			}
		}
		return cookies;
	};
	
	this.set_cookies = function( headers, cookies )
	{
		var pairs = [];
		for( var k in cookies )
		{
			pairs.push( k + '=' + cookies[k] );
		}
		headers['Set-Cookie'] = pairs.join(';');
	};

	this.resolvePath = function( path )
	{
		var fileName = fsPath.resolve(__dirname, this.config.webHome + '/' + path);
		return fileName;
	};

	this.sendFile = function( fileName, request, response, headers )
	{
		var hs = headers || {};
		var ext = fileName.split('.').pop();
		
		var parser = this.parsers[ext];

		fs.readFile(fileName, function(err,data)
		{
			if( err )
			{
				var mime = {"Content-Type": me.mimeType('html')};
				console.log( 'ERROR : ' + err);
				response.writeHead(505);
			}
			else
			{
				var h = {"Content-Type": me.mimeType(ext)};
				merge(h, hs);
				response.writeHead(200, h);
				if( parser )
					data = parser.parse( data );

				response.write( data );
			}
			response.end();
		});
	}

	this.serveFile = function(pathname, req, response, headers)
	{
		if( pathname == "/favicon.ico" && this.config.favicon )
			pathname = '/'+ this.config.favicon;
		else
			pathname = decodeURI(pathname);

		var fileName = fsPath.resolve(__dirname, this.config.webHome + pathname);
		this.sendFile( fileName, req, response, headers );
	}

	this.redirectToPage = function( req, res, page, headers )
	{
		var url = (req.socket.encrypted ? 'https://' : 'http://') + req.headers.host + page;
		this.redirectToUrl( res, url, headers );
	}

	this.listen = function()
	{
		function onRequest(request, response) 
		{
			var req = url.parse(request.url,true);
			var pathname = req.pathname;
			var method = request.method.toLowerCase();
			
			console.log(method + " " + pathname);
			//console.log(req);

			var pre = me.callbacks['preliminary'];
			if( pre )
			{
				var go_on = pre( request, response );
				if( !go_on )
					return;
			}
			

			// make path routing
			var route = me.get_route( pathname );
			if( route )
			{
				var callback = route.methods[ method];
				if( !callback )
				{
					// TODO: choose a better error management
					var mime = {"Content-Type": me.mimeType('html')};
					console.log( 'ERROR : ' + err);
					response.writeHead(505);
					return;
				}
				if( method == 'post' )
				{
					me.parse_post_parms( request, function( err, fields, files )
					{
						var parms = { ids: route.ids, fields: fields, files: files };
						callback(request, response, parms) ;
					});
				}
				else
				{
					var parms = { ids: route.ids, fields: req.query };
					callback(request, response, parms);
				}
				
				return;
			}

			// No route found: serve file
			me.serveFile(pathname, req, response);
			
		}

		var listen_port = this.config.port || DEF_HTTP_PORT;
		http.createServer(onRequest).listen(listen_port);

		console.log("Server has started on port "+listen_port+".");
		
		//console.log( util.inspect( me.routes ) );
	};
};

module.exports = 
{
	HttpServer: HttpServer
};