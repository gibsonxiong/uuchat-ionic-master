var express = require('express');
var router = express.Router();
var jwt = require('jsonwebtoken');
var User = require('../models/user');
var Relation = require('../models/relation');
var appConfig = require('../config/app-config');
var checkToken = require('../middlewares/checkToken');
var userService = require('../services/user');
var utils = require('../utils');
var sms = require('../sms');
var verificationCodesCache = {};				//验证码cache   
var verificationCodeTimesCache = {};			//验证码请求次数

//登录
// params:
//		username
//		password
router.post('/signin', function (req, res, next) {

	if (appConfig.debug) {
		User.findAdmin().then(function (user) {

			var token = jwt.sign(user, appConfig.secret);

			res.api({
				token: token
			});
		});

		return;
	}

	var username = req.body.username;
	var password = req.body.password;

	if (!username || !password) {
		return res.api(null, -1, '账号或密码错误！');
	}


	User.findOne({
			username: username
		})
		.exec()
		.then((user) => {
			//没有找到用户
			if (!user) {
				res.api(null, -1, '账号或密码错误！');
			}

			// 检查密码
			user.comparePassword(password, function (err, isMatch) {
				if (err) {
					res.api(null, -1, '账号或密码错误！');
				}

				if (isMatch) {
					// 创建token
					var token = jwt.sign({
						'userId': user._id
					}, appConfig.secret);

					// json格式返回token
					res.api({
						token: token
					});

				} else {
					res.api(null, -1, '账号或密码错误！');
				}


			});

		});
});




// 登出
// params:
//		username
//		password
router.post('/signout', function (req, res, next) {


});


//获取手机验证码
router.get('/getVerificationCode/:mobile', function (req, res, next) {
	var mobile = req.params.mobile;
	var code = utils.verificationCode(4);
	var effectiveTime = 3000;
	var maxTimes = 10;																				//最多请求次数(每天)
	var times = verificationCodeTimesCache[mobile] = verificationCodeTimesCache[mobile] || 0;		//请求次数
	var verificationCodes = verificationCodesCache[mobile]  = verificationCodesCache[mobile] || [];

	if(times > maxTimes) return res.api(null,-1,'今天获取短信验证码次数已到最多次数（'+ maxTimes+'），请明天再试！');

	verificationCodes.push(code);
	//有效时间effectiveTime过了，就删除
	setTimeout(()=>{
		verificationCodes.pop();
	},effectiveTime);

	sms.send(mobile, code);

	res.api();
});

//验证手机
router.post('/checkVerificationCode', function (req, res, next) {
	var mobile = req.body.mobile;
	var code = req.body.code;
	var verificationCodes = verificationCodesCache[mobile]  = verificationCodesCache[mobile] || [];

	//确认成功
	if(verificationCodes.indexOf(code) === -1) return res.api(null,-1,'短信验证码错误！');

	var mobileToken = jwt.sign(user, appConfig.secret);

	res.api({
		mobileToken: mobileToken
	});

});

//注册
router.post('/signup', function (req, res, next) {
	var mobileToken = req.body.mobileToken;
	var username = req.body.username;
	var password = req.body.password;

	var nickname = req.body.nickname;
	var gender = req.body.gender;

	User.create({
			mobile,
			username,
			password,
			nickname,
			gender
		})
		.exec()
		.then(user => {

		})
		.catch(res.errorHandler('注册用户失败！'));
});

//通过账号或手机号查找用户
router.get('/searchUser/:search', checkToken(), function (req, res, next) {
	var search = req.params.search;

	User.findBySearch(search)
		.exec()
		.then(user => {
			res.api(user);
		})
		.catch(res.errorHandler('查找用户失败！'));
});

//申请添加好友
router.get('/makeFriend/:userId', checkToken(), function (req, res, next) {
	var tokenId = req.userId;
	var toUserId = req.params.userId;
	var requestMsg = req.query.requestMsg;

	//查找是否已经申请
	var findPromise1 = Relation
		.findOne({
			fromUserId: tokenId,
			toUserId: toUserId
		})
		.exec();

	//查找是否已经被申请
	var findPromise2 = Relation
		.findOne({
			fromUserId: toUserId,
			toUserId: tokenId
		})
		.exec();


	//查找是否已经申请
	findPromise1.then(function (relation) {

		//如果已经存在，直接返回
		if (relation) return res.api(null, 1, '您已经申请过了！');

		//查找是否已经被申请
		findPromise2.then(function (relation) {
			if (relation) return res.api(null, 2, '该用户申请过你了！');

			//创建申请
			Relation.create({
				fromUserId: tokenId,
				toUserId: toUserId,
				requestMsg: requestMsg
			}, function (err, relation) {
				if (err) return res.api(null, -1, '申请添加好友失败！');

				res.api(null);
			});

		});

	});
});

//添加好友
router.get('/confirmFriend/:userId', checkToken(), function (req, res, next) {
	var tokenId = req.userId;
	var toUserId = req.params.userId;

	Relation.findOneAndUpdate({
			fromUserId: toUserId,
			toUserId: tokenId,
		}, {
			confirm: true,
		})
		.exec()
		.then(relation => {
			res.api(null);
		})
		.catch(res.errorHandler('添加好友失败！'));
});

//获取新好友列表
router.get('/getFriendNewList', checkToken(), function (req, res, next) {
	var tokenId = req.userId;

	Relation.find()
		.where({
			toUserId: tokenId,
		})
		.select('-toUserId -_toUser')
		.populate('_fromUser', '-password')
		.exec()
		.then(relations => {
			res.api(relations);
		})
		.catch(res.errorHandler('获取新好友列表失败！'));
});

//获取好友列表
router.get('/getFriendList', checkToken(), function (req, res, next) {
	var tokenId = req.userId;

	Relation.find({
			confirm: true
		})
		.or([{
				fromUserId: tokenId
			},
			{
				toUserId: tokenId
			},
		])
		.populate('_fromUser _toUser', '-password')
		.exec()
		.then(relations => {
			var friendList = [];

			relations.forEach(function (relation) {
				if (relation.fromUserId.equals(tokenId)) {
					friendList.push(relation._toUser);
				} else if (relation.toUserId.equals(tokenId)) {
					friendList.push(relation._fromUser);
				}
			});


			res.api(friendList);
		})
		.catch(res.errorHandler('获取好友列表失败！'));
});

//获取关系列表
router.get('/getRelationList', checkToken(), function (req, res, next) {
	var tokenId = req.userId;

	Relation.find()
		.or([{
				fromUserId: tokenId
			},
			{
				toUserId: tokenId
			},
		])
		.populate('_fromUser _toUser', '-password')
		.exec()
		.then(relations => {
			var newRelations = relations.map(function (relation) {
				relation = relation.toJSON();
				if (relation.fromUserId.equals(tokenId)) {
					relation._friend = relation._toUser;
				} else if (relation.toUserId.equals(tokenId)) {
					relation._friend = relation._fromUser;
				}

				delete relation._fromUser;
				delete relation._toUser;

				return relation;
			});

			res.api(newRelations);
		})
		.catch(res.errorHandler('获取关系列表失败！'));
});


//获取用户资料(自己)
router.get('/getOwn', checkToken(), function (req, res, next) {
	var tokenId = req.userId;

	User.findById(tokenId)
		.select('-password')
		.exec()
		.then(user => {
			res.api(user);
		})
		.catch(res.errorHandler('获取用户资料失败！'));
});

//修改昵称
router.get('/modNickname/:nickname', checkToken(), function (req, res, next) {
	var tokenId = req.userId;
	var nickname = req.params.nickname;

	User.findByIdAndUpdate(tokenId, {
			nickname: nickname
		}, {
			new: true
		})
		.select('-password')
		.exec()
		.then(user => {
			//推送修改过的user
			userService.pushUserModed(user);
			res.api(user);
		})
		.catch(res.errorHandler('修改昵称失败！'));
});

//修改性别
router.get('/modGender/:gender', checkToken(), function (req, res, next) {
	var tokenId = req.userId;
	var gender = new Number(req.params.gender);

	User.findByIdAndUpdate(tokenId, {
			gender: gender
		}, {
			new: true
		})
		.select('-password')
		.exec()
		.then(user => {
			res.api(user);
		})
		.catch(res.errorHandler('修改性别失败！'));
});

//修改个性签名
router.get('/modMotto/:motto?', checkToken(), function (req, res, next) {
	var tokenId = req.userId;
	var motto = req.params.motto;

	User.findByIdAndUpdate(tokenId, {
			motto: motto
		}, {
			new: true
		})
		.select('-password')
		.exec()
		.then(user => {
			res.api(user);
		}).catch(res.errorHandler('修改个性签名失败！'))
});



//获取用户资料
// data 
// {
// 	user:User,
// 	isFriend:boolean,
//  relationId:ObjectId
// }
router.get('/getUser/:userId', checkToken(), function (req, res, next) {
	var tokenId = req.userId;
	var toUserId = req.params.userId;

	User.findById(toUserId)
		.select('-password')
		.exec()
		.then(user => {
			if (!user) Promise.reject(res.customError(null, -1, '没有找到用户！'));

			if (user._id.equals(tokenId)) return Promise.reject(res.customError({
				user: user,
				isFriend: null,
				relationId: null,
			}, 0, null));

			var p = Relation.findOneByUserIds(tokenId, toUserId).exec();

			return Promise.all([user, p]);

		})
		.then(function (all) {
			var user = all[0];
			var relation = all[1];

			res.api({
				user: user,
				isFriend: !!relation,
				relationId: relation._id
			});
		})
		.catch(res.errorHandler('获取用户资料失败！'));



});






module.exports = router;