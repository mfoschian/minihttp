
var util = require('util');
var http = require("http");
var url = require("url");
var fs = require("fs");
var fsPath = require("path");
var formidable = require('formidable');

var DEF_HTTP_PORT = 80;

var APP_DIRNAME = fsPath.dirname(require.main.filename);

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


function pad2(n)
{
	if( typeof(n) == 'number' )
	{
		if( n >= 0 && n < 10 )
			return '0'+n;
		else
			return ''+n;
	}
	
	if( typeof(n) == 'string' )
	{
		if( n.length == 1 )
			return '0'+n;
		if( n.length > 1 )
			return n.substr(0,2);
	}
	
	return '00';
}

function formatDate( dt )
{
	var d = dt || new Date();
	return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function formatTime( dt )
{
	var d = dt || new Date();
	return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function formatDateTime( dt )
{
	var d = dt || new Date();
	return formatDate(d) + ' ' + formatTime(d);
}

function formatDateTimeMs( dt ) {
	var d = dt || new Date();
	var ms = d.getMilliseconds();
	if( ms < 10 )
		ms = '00' + ms;
	else if( ms < 100 ) {
		ms = '0' + ms;
	}
	return formatDate(d) + ' ' + formatTime(d) + '.' + ms;
}

function dup(o)
{
	var d = {};
	for( var k in o )
	{
		d[k] = o[k];
	}
	return d;
}

function merge(obj, ro) {	
	if( !obj || !ro ) return;
	if( typeof(ro) != 'object' ) return;
	
	var keys = Object.keys(ro);
	for( var i=0; i<keys.length; i++ ) {
		var k = keys[i];
		var v = ro[k];
		if( typeof(v) == 'object' ) {
			var o = obj[k] || {};
			merge( o, v );
			v = o;
		}
		obj[k] = v;
	}
}

function stringifyable(err) {
	var plainObject = {};
	Object.getOwnPropertyNames(err).forEach(function(key) {
		plainObject[key] = err[key];
	});
	//return JSON.stringify(plainObject, filter, space);
	return plainObject;
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
		debug: 0,
		port: DEF_HTTP_PORT,
		wwwroot: APP_DIRNAME,
		mimeTypes :
		{
			_default: 'text/plain'
			,txt: 'text/plain'
			,js: 'application/javascript'
			,html: 'text/html'
			,css : 'text/css'
			,gif: 'image/gif'
			,jpg: 'image/jpeg'
			,png: 'image/png'
			,ico: 'image/x-icon'
			,json: 'application/json'
			,ogg: 'application/ogg'
			,mp3: 'audio/mpeg'
			,vnc: 'application/x-vnc'
		}		
	};

	merge( this.config, args );
	
	this.parsers = {};
	this.routes = [];
	this.http = null;
		
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

	this.managePromise = function( P, response )
	{
		// Manage Promise results
		if( P && typeof( P.then ) == 'function' )
		{
			var me = this;
			P.then( function( data )
			{
				me.sendResponse( response, data );
			},
			function( err )
			{
				me.sendErrorResponse( response, err );
			});
		}
	};

	this.route = function( path, callback )
	{
		if( typeof(callback) == 'function' )
			// if not specified callback is on get method
			methods = { get: callback };
		else
			methods = callback;

		var rex = null;
		var ids = [];
		
		if( typeof(path.test) == 'function' )
		{
			// regexp passed !
			rex = path;
		}
		else
		{
			var u = url.parse( path );
			var r = new RegExp('{([^\/}]+)}','gi');

			var rpath = u.pathname.replace( r, function( match, p1 )
			{
				ids.push( p1 );
				return '([^\/]+)';
			});
			
			rex = new RegExp( '^'+rpath+'$' );
		}

		this.routes.push( { exp: rex, ids: ids, methods: methods } );
		return this;
	};
	this.get_route = function( path )
	{
		if( this.config.debug > 0 ) console.log('checking route for ['+path+']');

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
		//console.log( 'no route found' );
		return null;
	};
		

	
	this.mimeType =  function (s)
	{
		var m = this.config.mimeTypes[ s || '_default' ];
		return m || this.config.mimeTypes[ '_default' ];
	}

	this.putMimeType = function( s, m ) {
		if( typeof( s ) == 'object' ) {
			merge( this.config.mimeTypes, s );
		}
		else if( typeof( s ) == 'string' ) {
			this.config.mimeTypes[ s ] = m;
		}
	};

	var me = this;

	this.JsonOK = function(info)
	{
		return JSON.stringify({ result: 'OK', data: (info || '') });
	};
	
	this.JsonERR = function(err)
	{
		var e = '';
		if( typeof(err) == 'object' ) {
			e = stringifyable(err);
		}
		else
			e = err;

		return JSON.stringify({ result: 'ERR', error: e });
	};

	this.sendJSON = function( res, json, headers )
	{
		var h = {'content-type': this.mimeType('json')};
		for( var i in headers )
		{
			h[i] = headers[i];
		}
		res.writeHead(200, h);
		if( typeof(json) != 'string' )
			json = JSON.stringify(json);
		res.end(json);
	};

	this.sendHTML = function( response, html, headers )
	{
		var h = {"Content-Type": this.mimeType('html')};
		for( var i in headers )
		{
			h[i] = headers[i];
		}
		response.writeHead(200, h);
		response.write( html );
		response.end();
	};
	
	this.sendHTMLbody = function( response, html )
	{
		var h = '<html><body>'+html+'</body></html>';
		this.sendHTML( response, h );
	}
	
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

		if( this.config.uploadDirAbs )
			form.uploadDir = this.config.uploadDirAbs;
		else
			form.uploadDir = fsPath.resolve( fsPath.join(this.config.wwwroot, this.config.webHome, this.config.uploadDir) );

		form.on('field', function(field, value)
		{
			if( !field ) return;
			var regEx = /\[([^\]]+)\]/g;
			var match = regEx.exec(field);
			if( match )
			{
				var str = field;
				field = str.substr(0,match.index);
				var arr = fields[field];
				if( !arr )
				{
					arr = [];
					fields[field] = arr;
				}
				var index = match[1];
				
				match = regEx.exec(str);
				while( match ) 
				{
					var a = arr[index];
					if( !a )
					{
						a = [];
						arr[index] = a;
					}
					arr = arr[index];

					index = match[1];
					match = regEx.exec(str);
				}

				arr[index] = value;
			}
			else
			{
				fields[field] = value;
			}
		})
		.on('file', function(field, file)
		{
			if( file.size == 0 )
			{
				tmpFiles.push( file.path );
			}
			else
			{
				//console.log( util.inspect(file) );
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
		try
		{
			form.parse(request);
		}
		catch( e )
		{
			console.log( 'Form.parse exception: %s', util.inspect( e ) );
		}
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
		var fileName = fsPath.resolve( fsPath.join(this.config.wwwroot, this.config.webHome, path) );
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
			pathname = fsPath.join('/',this.config.favicon);
		else
		{
			try
			{
				pathname = decodeURI(pathname);
			}
			catch(e)
			{
				this.sendErrorResponse( response, e )
			}
		}

		var fileName = fsPath.resolve( fsPath.join(this.config.wwwroot, this.config.webHome, pathname) );
		//console.log('- serving '+fileName );
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
			try
			{
				var req = url.parse(request.url,true);
				var pathname = req.pathname;
				var method = request.method.toLowerCase();
				
				if( me.config.accesslog == true ) {
					// time / ip / port / method / url
					console.log( "*** %s - %s - %s - %s - %s", formatDateTimeMs(new Date()), request.socket.remoteAddress, request.socket.remotePort, method, pathname  );
				}
				if( me.config.debug > 0 ) console.log(method + " " + pathname);
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
						console.log( 'ERROR : No routing defined');
						response.writeHead(500);
						response.write( '<html><body><h1>Invalid Path</h1></body></html>' );
						response.end();
						return;
					}
					if( method == 'post' || method == 'put' )
					{
						me.parse_post_parms( request, function( err, fields, files )
						{
							var parms = { ids: route.ids, fields: fields, files: files };
							var P = callback(request, response, parms) ;
							me.managePromise( P, response );
						});
					}
					else
					{
						var parms = { ids: route.ids, fields: req.query };
						var P = callback(request, response, parms) ;
						me.managePromise( P, response );
					}
					
					return;
				}

				// No route found: serve file
				if( pathname == '/' && me.config.defaultPage )
					pathname = me.config.defaultPage;
				me.serveFile(pathname, req, response);
			}
			catch( err )
			{
				var mime = {"Content-Type": me.mimeType('html')};
				console.log( 'App exception: %s', err);
				response.writeHead(500);
				response.write( '<html><body><h1>Application error</h1><pre>'+err+'</pre></body></html>' );
				response.end();		
			}
		}

		var listen_port = this.config.port || DEF_HTTP_PORT;
		this.http = http.createServer(onRequest).listen(listen_port);

		console.log("Server has started on port "+listen_port+".");
		
		//console.log( util.inspect( me.routes ) );
	};
};

module.exports = 
{
	HttpServer: HttpServer
};
