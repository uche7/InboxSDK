var _ = require('lodash');
var BasicClass = require('../lib/basic-class');


var MessageViewDriver = function(){
	BasicClass.call(this);
};

MessageViewDriver.prototype = Object.create(BasicClass.prototype);

_.extend(MessageViewDriver.prototype, {

	getContentsElement: function(){},

	isElementInQuotedArea: function(element){},

	addAttachmentCard: function(options){},

	addButtonToDownloadAllArea: function(options){}

});

module.exports = MessageViewDriver;
