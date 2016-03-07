var _ = require('lodash');
var EventEmitter = require('../../lib/safe-event-emitter');

var AttachmentCardView = require('./attachment-card-view');

var memberMap = new WeakMap();

// documented in src/docs/
var MessageView = function(messageViewImplementation, appId, membraneMap, Conversations, driver){
	EventEmitter.call(this);

	var members = {};
	memberMap.set(this, members);

	members.messageViewImplementation = messageViewImplementation;
	members.membraneMap = membraneMap;
	members.Conversations = Conversations;
	members.driver = driver;

	this.destroyed = false;

	_bindToEventStream(this, members, messageViewImplementation.getEventStream());
};

MessageView.prototype = Object.create(EventEmitter.prototype);

_.extend(MessageView.prototype, {

	addAttachmentCardView: function(cardOptions){
		var attachmentCardViewDriver = memberMap.get(this).messageViewImplementation.addAttachmentCard(cardOptions);
		var attachmentCardView = new AttachmentCardView(attachmentCardViewDriver);

		return attachmentCardView;
	},

	addAttachmentCardViewNoPreview: function(cardOptions){
		var attachmentCardViewDriver = memberMap.get(this).messageViewImplementation.addAttachmentCardNoPreview(cardOptions);
		var attachmentCardView = new AttachmentCardView(attachmentCardViewDriver);

		return attachmentCardView;
	},

	addAttachmentsToolbarButton: function(buttonOptions){
		const {messageViewImplementation} = memberMap.get(this);
		messageViewImplementation.addButtonToDownloadAllArea({
			tooltip: buttonOptions.tooltip,
			iconUrl: buttonOptions.iconUrl,
			onClick() {
				const attachmentCardViews = messageViewImplementation.getAttachmentCardViewDrivers().map(cardDriver =>
					new AttachmentCardView(cardDriver)
				);
				buttonOptions.onClick({attachmentCardViews});
			}
		});
	},

	getBodyElement: function(){
		return memberMap.get(this).messageViewImplementation.getContentsElement();
	},

	getMessageID: function() {
		return memberMap.get(this).messageViewImplementation.getMessageID();
	},

	// TODO non-file-attachment card views are asynchronously loaded. Add some sort of
	// registerAttachmentCardViewHandler function to listen for other types of
	// attachment cards.
	getFileAttachmentCardViews: function(){
		var self = this;
		return _.chain(memberMap.get(this).messageViewImplementation.getAttachmentCardViewDrivers())
			.filter(function(cardDriver) {
				return cardDriver.getAttachmentType() === 'FILE';
			})
			.map(function(attachmentCardViewDriver){
				return new AttachmentCardView(attachmentCardViewDriver, self);
			})
			.value();
	},

	// Deprecated name
	getAttachmentCardViews: function(){
		memberMap.get(this).driver.getLogger().deprecationWarning('MessageView.getAttachmentCardViews', 'MessageView.getFileAttachmentCardViews');
		return this.getFileAttachmentCardViews();
	},

	isElementInQuotedArea: function(element){
		return memberMap.get(this).messageViewImplementation.isElementInQuotedArea(element);
	},

	isLoaded: function() {
		return memberMap.get(this).messageViewImplementation.isLoaded();
	},

	getLinksInBody: function(){
		return memberMap.get(this).messageViewImplementation.getLinks();
	},

	getSender: function(){
		return memberMap.get(this).messageViewImplementation.getSender();
	},

	getRecipients: function(){
		return memberMap.get(this).messageViewImplementation.getRecipients();
	},

	getThreadView: function(){
		var members = memberMap.get(this);
		return members.membraneMap.get(members.messageViewImplementation.getThreadViewDriver());
	},

	getDateString: function() {
		return memberMap.get(this).messageViewImplementation.getDateString();
	},

	addAttachmentIcon: function(iconDescriptor) {
		return memberMap.get(this).messageViewImplementation.addAttachmentIcon(iconDescriptor);
	},

	getViewState: function() {
		var members = memberMap.get(this);
		return members.Conversations.MessageViewViewStates[members.messageViewImplementation.getViewState()];
	}

});


function _bindToEventStream(messageView, members, stream){
	stream.onEnd(function(){
		messageView.destroyed = true;
		messageView.emit('destroy');

		messageView.removeAllListeners();
	});

	stream
		.filter(function(event){
			return event.type !== 'internal' && event.eventName === 'contactHover';
		})
		.onValue(function(event){
			messageView.emit(event.eventName, {
				contactType: event.contactType,
				contact: event.contact,
				messageView: messageView,
				threadView: messageView.getThreadView()
			});
		});

	stream
		.filter(function(event){
			return event.eventName === 'messageLoad';
		})
		.onValue(function(event){
			messageView.emit('load', {
				messageView: messageView
			});
		});

	stream
		.filter(function(event){
			return event.eventName === 'viewStateChange';
		})
		.onValue(function(event){
			messageView.emit('viewStateChange', {
				oldViewState: members.Conversations.MessageViewViewStates[event.oldValue],
				newViewState: members.Conversations.MessageViewViewStates[event.newValue],
				messageView: messageView
			});
		});
}

module.exports = MessageView;
