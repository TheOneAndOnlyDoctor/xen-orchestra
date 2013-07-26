var _ = require('underscore');
var crypto = require('crypto');
var hashy = require('hashy');
var Q = require('q');

var Collection = require('./collection');
var Model = require('./model');
var Xapi = require('./xapi');

//////////////////////////////////////////////////////////////////////

var check = function () {
	var errors;

	var validator = new (require('validator').Validator)();
	validator.error = function (err) {
		(errors || (errors = [])).push(err);
		return this;
	};

	var check = function (data) {
		validator.check(data);
	};
	check.pop = function () {
		var res = errors;
		errors = undefined;
		return res;
	};

	return check;
}();

//////////////////////////////////////////////////////////////////////
// Models
//////////////////////////////////////////////////////////////////////

var Server = Model.extend({
	'validate': function () {
	},
});

// @todo We could also give a permission level to tokens (<=
// user.permission).
var Token = Model.extend({
	// Validates model attributes.
	// 'validate': function (attr) {
	// 	check(attr.id).len(10);
	// 	check(attr.user_id).isInt();

	// 	return check.pop();
	// },
}, {
	'generate': function (user_id) {
		return Q.ninvoke(crypto, 'randomBytes', 32).then(function (buf) {
			return new Token({
				'id': buf.toString('base64'),
				'user_id': user_id,
			});
		});
	},
});

var User = Model.extend({
	'default': {
		'permission': 'none',
	},

	// Validates model attributes.
	// 'validate': function (attr) {
	// 	check(attr.id).isInt();
	// 	check(attr.email).isEmail();
	// 	check(attr.pw_hash).len(40);
	// 	check(attr.permission).isIn('none', 'read', 'write', 'admin');

	// 	return check.pop();
	// },

	'setPassword': function (password) {
		var self = this;
		return hashy.hash(password).then(function (hash) {
			self.set('pw_hash', hash);
		});
	},

	// Checks and updates the hash if necessary.
	'checkPassword': function (password) {
		var hash = this.get('pw_hash');
		var user = this;

		return hashy.verify(password, hash).then(function (success) {
			if (!success)
			{
				return false;
			}

			if (hashy.needsRehash(hash))
			{
				return user.setPassword(password).thenResolve(true);
			}

			return true;
		});
	},

	'hasPermission': function (permission) {
		var perms = {
			'none': 0,
			'read': 1,
			'write': 2,
			'admin': 3,
		};

		return (perms[this.get('permission')] >= perms[permission]);
	},
});

var Pool = Model.extend({});

var Host = Model.extend({});

var VM = Model.extend({});

var Network = Model.extend({});

var SR = Model.extend({});

var VDI = Model.extend({});

//////////////////////////////////////////////////////////////////////
// Collections
//////////////////////////////////////////////////////////////////////

var Servers = Collection.extend({
	'model': Server,
});

var Tokens = Collection.extend({
	'model': Token,

	'generate': function (user_id) {
		var self = this;
		return Token.generate(user_id).then(function (token) {
			return self.add(token);
		});
	}
});

// @todo handle email uniqueness.
var Users = Collection.extend({
	'model': User,

	'create': function (email, password, permission) {
		var user = new User({
			'email': email,
		});
		if (permission)
		{
			user.set('permission', permission);
		}

		var self = this;
		return  user.setPassword(password).then(function () {
			return self.add(user);
		});
	}
});

var Pools = Collection.extend({
	'model': Pool,
});

var Hosts = Collection.extend({
	'model': Host,
});

var VMs = Collection.extend({
	'model': VM,
});

var Networks = Collection.extend({
	'model': Network,
});

var SRs = Collection.extend({
	'model': SR,
});

var VDIs = Collection.extend({
	'model': VDI,
});

//////////////////////////////////////////////////////////////////////

function Xo()
{
	if ( !(this instanceof Xo) )
	{
		return new Xo();
	}

	//--------------------------------------
	// Main objects (@todo should be persistent).

	this.servers = new Servers();
	this.tokens = new Tokens();
	this.users = new Users();

	// This events are used to automatically close connections if the
	// associated credentials are invalidated.
	var self = this;
	this.tokens.on('remove', function (token_ids) {
		_.each(token_ids, function (token_id) {
			self.emit('token.revoked:'+ token_id);
		});
	});
	this.users.on('remove', function (user_ids) {
		_.each(user_ids, function (user_id) {
			self.emit('user.revoked:'+ user_id);
		});
	});

	// Connections to Xen pools/servers.
	this.connections = {};

	//--------------------------------------
	// Xen objects.

	this.pools = new Pools();
	this.hosts = new Hosts();
	this.vms = new VMs();

	this.networks = new Networks();
	this.srs = new SRs();
	this.vdis = new VDIs();

	// Connecting classes: VIF & PIF, VBD & SR.

	// -------------------------------------
	// Temporary data for testing purposes.

	this.servers.add([{
		'host': '192.168.1.116',
		'username': 'root',
		'password': 'qwerty',
	}]).done();
	this.users.add([{
		'email': 'bob@gmail.com',
		'pw_hash': '$2a$10$PsSOXflmnNMEOd0I5ohJQ.cLty0R29koYydD0FBKO9Rb7.jvCelZq',
		'permission': 'admin',
	}, {
		'email': 'toto@gmail.com',
		'pw_hash': '$2a$10$PsSOXflmnNMEOd0I5ohJQ.cLty0R29koYydD0FBKO9Rb7.jvCelZq',
		'permission': 'none',
	}]).done();
}
require('util').inherits(Xo, require('events').EventEmitter);

Xo.prototype.start = function () {

	var xo = this;

	// @todo Connect to persistent collection.

	// @todo Connect to Xen servers & fetch data.
	xo.servers.get().then(function (servers) {
		/* jshint maxparams:99 */

		_.each(servers, function (server) {
			var xapi = new Xapi(server.host);
			xo.connections[server.id] = xapi;

			xapi.connect(server.username, server.password).then(function () {
				var get_records = function (classes) {
					var promises = [];
					for (var i = 0, n = classes.length; i < n; i++)
					{
						!function (klass) {
							promises.push(
								xapi.call(klass +'.get_all_records')
									.fail(function (error) {
										console.error(klass, error);
										return {};
									})
							);
						}(classes[i]);
					}
					return Q.all(promises);
				};

				return get_records([
					// Main classes.
					'pool',
					'host',
					'VM',

					'network',
					'SR',
					'VDI',

					// Associated classes (e.g. metrics).
					'console',
					'crashdump',
					'DR_task',
					'host_cpu',
					'host_crashdump',
					'host_metrics',
					'host_patch',
					'message',
					'PBD',
					'PCI',
					'PGPU',
					'PIF',
					'VBD',
					'VGPU',
					'VIF',
					'VM_appliance',
					'VM_metrics',
					'VM_guest_metrics',
					'VMPP',
					'VTPM',
				]);
			}).spread(function (
				pools,
				hosts,
				vms,

				networks,
				srs,
				vdis,

				consoles,
				crashdumps,
				dr_tasks,
				host_cpus,
				host_crashdumps,
				host_metrics,
				host_patches,
				messages,
				pbds,
				pcis,
				pgpus,
				pifs,
				vbds,
				vgpus,
				vifs,
				vm_appliances,
				vm_metrics,
				vm_guest_metrics,
				vmpps,
				vtpms
			) {
				// Special case for pools.
				pools = _.values(pools);
				var pool_uuid = pools[0].id = pools[0].uuid;

				var resolve = function (model, collection, props, include) {
					/* jshint laxbreak: true */

					if (!_.isArray(props))
					{
						props = [props];
					}

					var helper;
					if (include)
					{
						helper = function (ref) {
							return collection[ref] || null;
						};
					}
					else
					{
						helper = function (ref) {
							var model = collection[ref];
							return model && model.uuid || null;
						};
					}

					for (var i = 0, n = props.length; i < n; ++i)
					{
						var prop = props[i];
						var ref = model[prop];

						model[prop] = _.isArray(ref)
							? _.map(ref, helper) // @todo Correctly handle objects.
							: helper(ref);
					}
				};

				// @todo Messages are linked differently.
				messages = _.groupBy(messages, 'obj_uuid');

				// Resolves dependencies.
				//
				// 1. Associated objects are included.
				// 2. Linked objects are relinked using their uuid instead of
				//    their reference.
				_.each(pools, function (pool) {
					// @todo Blobs?

					resolve(pool, srs, [
						'crash_dump_SR',
						'default_SR',
						'suspend_image_SR',
					]);
					resolve(pool, hosts, 'master');
					resolve(pool, vdis, [
						'metadata_VDIs',
						'redo_log_vdi',
					]);
				});
				_.each(hosts, function (host) {
					// @todo Blobs?

					resolve(host, srs, [
						'crash_dump_sr',
						'local_cache_sr',
						'suspend_image_SR',
					]);
					resolve(host, host_crashdumps, 'host_crashdumps', true);
					resolve(host, host_cpus, 'host_CPUs', true);
					resolve(host, host_metrics, 'metrics', true);
					resolve(host, host_patches, 'patches', true);
					resolve(host, pbds, 'PBDs', true);
					resolve(host, pcis, 'PCIs', true);
					resolve(host, pgpus, 'PGPUs', true);
					resolve(host, pifs, 'PIFs', true);
					resolve(host, vms, 'resident_VMs');
				});
				_.each(vms, function (vm) {
					// @todo Blobs?

					resolve(vm, hosts, [
						'affinity',
						'resident_on',
					]);
					resolve(vm, vm_appliances, 'appliance', true);
					resolve(vm, pcis, 'attached_PCIs', true);
					resolve(vm, vms,  [
						'children', // Snapshots?
						'parent',
						'snapshot_of',
					]);
					resolve(vm, consoles, 'consoles', true);
					resolve(vm, crashdumps, 'crash_dumps', true);
					resolve(vm, vm_guest_metrics, 'guest_metrics', true);
					vm.messages = messages[vm.uuid] || null; // @todo
					resolve(vm, vm_metrics, 'metrics', true);
					resolve(vm, vmpps, 'protection_policy', true);
					resolve(vm, srs, 'suspend_SR');
					resolve(vm, vdis, 'suspend_VDI');
					resolve(vm, vbds, 'VBDs');
					resolve(vm, vgpus, 'VGPUs');
					resolve(vm, vifs, 'VIFs');
					resolve(vm, vtpms, 'VTPMs');
				});
				_.each(networks, function (network) {
					// @todo Blobs?

					resolve(network, pifs, 'PIFs');
					resolve(network, vifs, 'VIFs');
				});
				_.each(srs, function (sr) {
					// @todo Blobs?

					resolve(sr, dr_tasks, 'introduced_by');
					resolve(sr, pbds, 'PBDs');
					resolve(sr, vdis, 'VDIs');
				});
				_.each(vdis, function (vdi) {
					resolve(vdi, crashdumps, 'crash_dumps', true);
					resolve(vdi, pools, 'metadata_of_pool');
					resolve(vdi, vdis, [
						'parent',
						'snapshot_of',
						'snapshots',
					]);
					resolve(vdi, srs, 'SR');
					resolve(vdi, vbds, 'VBDs');
				});

				// Normalizes the collections.
				//
				// 1. The collection is converted to an array.
				// 2. For each object, an identifier based on its uuid is
				//    created.
				var normalize = function (items) {
					return _.map(items, function (item) {
						item.id = item.uuid;
						item.pool_uuid = pool_uuid;
						return item;
					});
				};

				return Q.all([
					xo.pools.add(pools), // Special case.
					xo.hosts.add(normalize(hosts)),
					xo.vms.add(normalize(vms)),

					xo.vms.add(normalize(networks)),
					xo.vms.add(normalize(srs)),
					xo.vms.add(normalize(vdis)),
				]);
			}).done();
		});
	}).done();

	//--------------------------------------

	xo.emit('started');
};

//////////////////////////////////////////////////////////////////////

module.exports = Xo;
