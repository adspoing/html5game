var connect = require('connect');
var serveStatic = require('serve-static');
connect().use(serveStatic(__dirname)).listen(8080);
var io = require('socket.io').listen(1380);
var mongoose = require('mongoose');    //引用mongoose模块
var db=mongoose.createConnection('localhost','test');
var users = db.model('User', { name: String,password:String,kill:Number,rank:Number});

var sockets = {}, 
    players ={},
    bombs = {}, 
    nextId = 1, 
    nextBombId = 1, 
    totalPlayers = 0, 
    alivePlayers = 0, 
    timeleft = 0,
    bobs=1,
    nowBomb=0,
    naame={};

// 0 - empty  1 - wall can bomb  2- must be wall  -1 -must be empty  
// -2 flame  -3 chunqiu flame++ -4 yumaoshan bomb ++
//100 bomb
var map, map_template = [
		[-1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1],
		[-1, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, -1],
		[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		[0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0],
		[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		[0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0],
		[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		[0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0],
		[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		[0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0],
		[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
		[-1, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, -1],
		[-1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1]
	];

setInterval(function() {
	timeleft--; 
	if (timeleft <= 0 && !starting) {
		starting = true;
		setTimeout(newGame, 3000);
	}
}, 1000);

// update player positions
function update(timestamp) {
	for (var id in players) if (players[id].playing) {
		var p = players[id];

		/* moving */
		var power = (timestamp - p.timestamp) / 6;
		p.timestamp = timestamp;
		if (power == 0) continue;
		while (power > 0) {
			var kx = 0, ky = 0;
			if (p.keys[0]) {
				kx -= 1;
			}
			if (p.keys[1]) {
				ky -= 1;
			}
			if (p.keys[2]) {
				kx += 1;
			}
			if (p.keys[3]) {
				ky += 1;
			}

			var posx = Math.floor(p.x / 50);
			var posy = Math.floor(p.y / 50);
		
			var rposx = Math.floor((p.x + 25) / 50);
			var rposy = Math.floor((p.y + 25) / 50);
			var rposi = map[rposy][rposx];
			// ignore bomb if player is standing on it
			if (rposi == 100) {
				map[rposy][rposx] = 0;
			}
		
			var mx = 0, my = 0, amp = 0;

			// normal move
			if (p.y % 50 == 0) {
				if (kx > 0) {
					if (map[posy][posx + 1] <= 0) {
						amp = 50 - p.x % 50;
						mx = 1;
						kx = ky = 0;
					}
				} else if (kx < 0) {
					if (map[posy][posx - 1] <= 0) {
						amp = 50;
					}
					amp += p.x % 50;
					if (amp > 0) {
						mx = -1;
						kx = ky = 0;
					}
				}
			}	
			if (p.x % 50 == 0) {
				if (ky > 0) {
					if (posy + 1 < map.length && map[posy + 1][posx] <= 0) {
						amp = 50 - p.y % 50;
						my = 1;
						kx = ky = 0;
					}
				} else if (ky < 0) {
					if (posy > 0 && map[posy - 1][posx] <= 0) {
						amp = 50;
					}
					amp += p.y % 50;
					if (amp > 0) {
						my = -1;
						kx = ky = 0;
					}
				}
				ky = 0;
			}

			// around the corners
			if (kx != 0) {
				if (map[posy][posx + kx] <= 0) {
					amp = p.y % 50;
					my = -1;
					kx = ky = 0;
				} else if (posy + 1 < map.length && map[posy + 1][posx] <= 0 && map[posy + 1][posx + kx] <= 0) {
					amp = 50 - p.y % 50;
					my = 1;
					kx = ky = 0;
				}
			}
			if (ky != 0) {
				if (posy + ky >= 0 && posy + ky < map.length) {
					if (map[posy + ky][posx] <= 0) {
						amp = p.x % 50;
						mx = -1;
						kx = ky = 0;
					} else if (map[posy][posx + 1] <= 0 && map[posy + ky][posx + 1] <= 0) {
						amp = 50 - p.x % 50;
						mx = 1;
						kx = ky = 0;
					}
				}
			}
		
			map[rposy][rposx] = rposi;
	
			if (amp == 0) break;
			amp = Math.min(amp, power);
			p.x += mx * amp;
			p.y += my * amp;
			power -= amp;
		}
	}
}

//broadcast the msg
function toRoom(event, data) {
	for(var id in sockets) {
		sockets[id].emit(event, data);
	}
}

//check the hero is alive or the game should be restarted
function checkAlive() {
	if (alivePlayers < 2 && alivePlayers != totalPlayers && !starting) {
		starting = true;
		setTimeout(newGame, 3000);
	}
}

// bomb boom 
function boom(bid, chain) {
	if (!bombs[bid]) return [];
	map[bombs[bid].y][bombs[bid].x] = 0;
	toRoom('boom', {id: bid});

	update(Date.now());

	pos_map = {};
	for (var id in players) if (players[id].playing) {
		var p = players[id];
		var pos = Math.floor((p.x + 25) / 50) + ' ' + Math.floor((p.y + 25) / 50);
		if (!pos_map[pos]) pos_map[pos] = [];
		pos_map[pos].push({type: 'p', id: id});
	}
	for (var id in bombs) if (id != bid) {
		var b = bombs[id];
		var pos = b.x + ' ' + b.y;
		if (!pos_map[pos]) pos_map[pos] = [];
		pos_map[pos].push({type: 'b', id: id});
	}

	var b = bombs[bid];
	var dirs = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]];
	var explode = [], explosion = [];
	for (var dir in dirs) {
		for (var i = 1; i <= players[b.player].flame; i++) {
			var x = b.x + i * dirs[dir][0], y = b.y + i * dirs[dir][1];
			if (y < 0 || y >= map.length || x < 0 || x >= map[0].length || map[y][x] == 2 || map[y][x] == -2) break;
		
			if (map[y][x] == 1) {
				if (Math.floor(Math.random() * 4) == 0) {
					map[y][x] = -3;
				} 
				else if(Math.floor(Math.random()*4)==1)
					{
						map[y][x]=-4;
					}
					else {
					map[y][x] = -2;
					explosion.push({x: x, y: y});
				}
				break;
			}
		
			map[y][x] = -2;
			explosion.push({x: x, y: y});
		
			var p = pos_map[x + ' ' + y];
			if (p) {
				for (var j in p) {
					if (p[j].type == 'b') {
						explode.push(p[j].id);
					} else if (p[j].type == 'p') {
						console.log(naame[p[j].id]);
						 // users.update({name:naame[p[j].id]},{'$inc':{kill:1}});
						     users.update({name:naame[p[j].id]},{'$inc':{kill:1}},function(err){});
						 var a;
						users.find({'name':naame[p[j].id]},function(error,result)
						{
							if(error)
								console.log(error);
							else
								{console.log(result);
								  //   a=result[0].kill+1;
    						// 		users.update({'name':result[0].name}, {'$set': { 'kill':  result[0].kill+1}});
								  // console.log(a);
								}
						})
						  // users.update({'name':naame[p[j].id]}, { $set: { kill: a }});

						players[p[j].id].playing = false;
						alivePlayers--;
						toRoom('move', {id: p[j].id, data: players[p[j].id]});
					}
				}
				break;
			}
		}
	}
	delete bombs[bid];

	for (var i in explode) {
		explosion = explosion.concat(boom(explode[i], true));
	}

	if (chain) {
		return explosion;
	} else {
		toRoom('map', map);

		setTimeout(function(explosion) {
			for (var i in explosion) {
				map[explosion[i].y][explosion[i].x] = 0;
			}
			toRoom('map', map);
		
			checkAlive();
		}, 500, explosion);
	}
	    nowBomb=0;
}

// restart game
var starting = false;
function newGame() {
	console.log('new game');
	starting = false;
	
	timeleft = 300;

	bombs = {}

	map = [];
	for (var i = 0; i < map_template.length; i++) {
		map[i] = [];
		for (var j = 0; j < map_template[i].length; j++) {
			map[i][j] = 0;
			if (map_template[i][j] == 0 && Math.floor(Math.random() * 5) < 4) {
				map[i][j] = 1;
			} else if (map_template[i][j] > 0) {
				map[i][j] = map_template[i][j];
			}
		}
	}

	var pos = 0;
	for (var id in players) {
		var p = players[id];
		p.playing = true;
		p.keys = [false, false, false, false];
		p.flame = 1;
		p.bobs=1;
		if (pos == 0) {
			p.x = 0;
			p.y = 0;
			p.spriteY = 2;
		}
		if (pos == 1) {
			p.x = 600;
			p.y = 0;
			p.spriteY = 1;
		}
		if (pos == 2) {
			p.x = 0;
			p.y = 600;
			p.spriteY = 2;
		}
		if (pos == 3) {
			p.x = 600;
			p.y = 600;
			p.spriteY = 1;
		}
		pos = (pos + 1) % 4;
	}

	alivePlayers = totalPlayers;

	toRoom('game', {players: players, map: map, timeleft: timeleft});
}
newGame();

io.sockets.on('connection', function(socket) {
	var id = nextId++, names = 'test ' + id;

	var people = Math.floor(Math.random() * 8);
	totalPlayers++;


	socket.emit('hello', {id: id, name: names, players: players, bombs: bombs, map: map, people: people, timeleft: timeleft});
	players[id] = {name: names, playing: false, people: people, x: 0, y: 0, keys: [false, false, false, false], spriteY: 2, flame: 1,bobs:1,kill:0};
	sockets[id] = socket;
	toRoom('joined', {id: id, data: players[id]});
	// console.log("connect "+players[id].name);



	socket.on('move', function(data) {
		if (players[id].playing) {
			players[id] = data;
			toRoom('move', {id: id, data: data});
			players[id].timestamp = Date.now();
				     console.log("id"+id+"'s name  "+naame[id]);

			users.find().sort({'kill':-1}).exec(function(err,posts){
                           	socket.emit('rank',{post:posts});
                           //	console.log(posts);
                           });
                          
		}
	});


	socket.on('hello2',function(data)
	{
		var aa=new users({name:data.account,kill:'0',rank:'0'});
		//console.log(aa.name);
		aa.save(function(err)
		{
			if(err)
				console.log(err);
			else
				console.log("success");
		});
	     toRoom('hello2', {id: id, name: data.account});
	     			     // console.log("aa");
	      players[id].name=data.account;
	     // console.log(id);
	      naame[id]=data.account;
	     console.log("id"+id+"'s name  "+naame[id]);

	});
    //var aa=new users({name:'test2',password:'123',kill:"3",rank:"2"});
//    aa.save();
  //  users.find({ name: 'test2' }, function (err) {
  //if (err) return handleError(err);
  // removed!
  //else console.log();
//});
	socket.on('plant', function(data) {
		//var id =  nextBombId++;
	   // console.log("connect "+players[id].name);
	     // console.log("id"+id+"'s name  "+players[id].name);
	     // console.log("id"+id+"'s name  "+players[id].name);

		var idd=nextBombId++;
		//console.log(id);
		//console.log(idd);
		nowBomb++;
		if(nowBomb<=players[id].bobs){
		bombs[idd] = data;
		map[data.y][data.x] = 100;
		toRoom('plant', {id: idd, data: data});
		setTimeout(boom, 2000, idd);
	} 
	});
	
	socket.on('pickup', function(data) {
			     // console.log("id"+id+"'s name  "+players[id].name);

		if (map[data.y][data.x] == -3) {
			map[data.y][data.x] = 0;
			players[id].flame++;
			toRoom('flame', {id: id, flame: players[id].flame});
		}
		if(map[data.y][data.x]==-4)
		{
			map[data.y][data.x]=0;
			players[id].bobs++;
			//console.log(id);
			//console.log(players[id].bobs);
			toRoom('bobs',{id:id,bobs:players[id].bobs});
		}  
		    toRoom('map', map);
	});
	
	socket.on('reshape', function(data) {
		players[id].people = data.people;
		toRoom('reshape', {id: id, people: data.people});
	});

	
	socket.on('disconnect', function() {
		totalPlayers--;
		if (players[id].playing) alivePlayers--;
		checkAlive();
		delete players[id];
		delete sockets[id];
		toRoom('gone', {id: id});
	});
	
	if (totalPlayers <= 2 && !starting) {
		starting = true;
		setTimeout(newGame, 1000);
	}
});
