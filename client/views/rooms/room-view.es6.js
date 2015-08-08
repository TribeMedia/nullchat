Template.roomView.helpers({
    room() {
        return Rooms.findOne({_id: Session.get('currentRoom')});
    },
    currentRoom() {
        return Session.get('currentRoom');
    },
    availableRooms() {
        return Rooms.find();
    },
    messageLimit() {
        return Session.get('messageLimit');
    }
});

const isReady = {};
const scroll = {};

Template.roomView.events({
    'click #loadMore'(e) {
        Session.set('messageLimit', Session.get('messageLimit') + 20);
        e.preventDefault();
    },
    'scroll #roomContainer'(e) {
        const room = $("#roomContainer");
        if (room.scrollTop() < 50 && !scroll.needScroll && isReady.messages) {
            scroll.needScroll = true;
            scroll.previousHeight = $("#scrollContainer").height();
            Client.incMessageLimit(20);
        }
    },
    'click .launch'(event, template) {
        $('.sidebar').sidebar('setting', 'transition', 'overlay').sidebar('toggle');
    },
    'click, scroll'() {
        Session.set('unreadMessages', 0);
    }
});

Template.roomView.onRendered(function () {
    Meteor.call('setSeen', Session.get('currentRoom'));
    $('.ui.sidebar').sidebar({dimPage: false, closable: false}).sidebar('toggle');
});

Template.roomView.onCreated(function () {
    isReady.notifications = false;
    isReady.messages = false;
    let nowTimestamp;
    Session.setDefault('messageLimit', 10);
    Deps.autorun(function () {
        nowTimestamp = new Date().getTime();
        Meteor.subscribe('messages', Session.get('currentRoom'), Session.get('messageLimit'), {
            onReady() {
                isReady.messages = true;
                if (scroll.needScroll) {
                    const room = $("#roomContainer");
                    scroll.needScroll = false;
                    const offset = $("#scrollContainer").height() - scroll.previousHeight;
                    room.scrollTop(room.scrollTop() + offset);
                }
                else {
                    Client.scrollChatToBottom();
                }
            }
        });
        Meteor.subscribe('feedbackMessages', Session.get('currentRoom'));
    });

    const clickSound = new buzz.sound('/sounds/click_04.wav');
    const chimeSound = new buzz.sound('/sounds/chime_bell_ding.wav');

    const permission = notify.permissionLevel();
    if (permission === notify.PERMISSION_DEFAULT) {
        notify.requestPermission();
    }
    notify.config({pageVisibility: false, autoClose: 5000});


    Notifications.find({timestamp: {$gt: nowTimestamp}}).observe({
        added(document) {
            if (isReady.notifications) {
                // HACK: should be replaced by a full 'seen' message sub system
                if ((new Date().getTime() - document.timestamp) < 10000) {
                    chimeSound.play();
                    if (roomPreferencesOrDefault(document.roomId).desktopNotificationMention) {
                        if (permission === notify.PERMISSION_GRANTED) {
                            const title = `${document.authorName}(#${document.roomName})`;
                            const user = Meteor.users.findOne({_id: document.authorId}, {fields: {"profile.avatar": 1}});
                            const avatar = user && user.profile && user.profile.avatar || '/images/logo64.png';
                            notify.createNotification(title, {
                                body: document.message,
                                icon: avatar,
                                tag: document.messageId
                            });
                        }
                    }
                }
            }
        }
    });
    Messages.find({timestamp: {$gt: nowTimestamp}}).observe({
        added(doc) {
            if (isReady.messages && doc && doc.type !== 'feedback' && doc.authorId !== Meteor.userId()) {
                // HACK: should be replaced by a full 'seen' message sub system
                if ((new Date().getTime() - doc.timestamp) < 10000) {
                    if (roomPreferencesOrDefault(doc.roomId).playMessageSound) {
                        clickSound.play();
                    }

                    if (roomPreferencesOrDefault(doc.roomId).desktopNotificationAllMessages && doc.type !== 'rich') {
                        if (permission === notify.PERMISSION_GRANTED) {
                            const user = Meteor.users.findOne({_id: doc.authorId}, {
                                fields: {
                                    "profile.avatar": 1,
                                    "username": 1
                                }
                            });
                            const room = Rooms.findOne({_id: doc.roomId});
                            const title = user.username + "(#" + room.name + ")";
                            const avatar = user && user.profile && user.profile.avatar || '/images/logo64.png';
                            notify.createNotification(title, {body: doc.message, icon: avatar, tag: doc._id});
                        }
                    }

                    if (!document.hasFocus()) {
                        let currentUnreadMessageCount = Session.get('unreadMessages');
                        currentUnreadMessageCount += 1;
                        Session.set('unreadMessages', currentUnreadMessageCount);
                    }

                    if (doc.roomId !== Session.get('currentRoom')) {
                        Client.incRoomUnread(doc.roomId);
                    }
                }
            }
            if (!scroll.needScroll) {
                // rough percentage toward the top of the scroll view
                const perctentToTop = ($("#scrollContainer").height() - $("#roomContainer").scrollTop() - $("#roomContainer").height()) / $("#scrollContainer").height();
                if (perctentToTop < 0.05) {
                    setTimeout(Client.scrollChatToBottom, 100);
                }
            }
        }
    });

    Messages.find({authorId: Meteor.userId()}).observe({
        changed(newDoc, oldDoc) {
            if (newDoc.likedBy.length - oldDoc.likedBy.length === 1) {
                const likedBy = _.difference(newDoc.likedBy, oldDoc.likedBy)[0];
                if (likedBy === Meteor.userId()) {return;}
                if (permission === notify.PERMISSION_GRANTED) {
                    const user = Meteor.users.findOne({_id: likedBy}, {fields: {"profile.avatar": 1, "username": 1}});
                    if (!user) { return; }
                    const avatar = user.profile && user.profile.avatar || '/images/logo64.png';
                    const title = user.username + " gave you a star.";
                    const body = `For "${newDoc.message}"`;
                    notify.createNotification(title, {body: body, icon: avatar, tag: newDoc._id});
                }
            }
        }
    });

    Session.set('unreadMessages', 0);
    Deps.autorun(function () {
        const numberOfUnreadMessages = Session.get('unreadMessages');
        const currentRoom = Rooms.findOne({_id: Session.get('currentRoom')});

        let currentRoomString = '';

        if (currentRoom.direct) {
            const otherUserId = UserHelpers.otherUserId(currentRoom.users);
            currentRoomString = "@" + UserHelpers.usernameForUserId(otherUserId) + ' ';
        }
        else {
            currentRoomString = '#' + currentRoom.name + ' ';
        }

        if (numberOfUnreadMessages > 0) {
            document.title = "(" + numberOfUnreadMessages + ")" + " " + currentRoomString + window.location.hostname;
        }
        else {
            document.title = currentRoomString + window.location.hostname;
        }
    });

    Deps.autorun(function () {
        const rooms = Rooms.find({users: Meteor.userId()}, {fields: {_id: 1}}).fetch();
        if (rooms) {
            for (let i = 0; i < rooms.length; i++) {
                const roomId = rooms[i]._id;
                Meteor.subscribe('newMessagesForRoom', roomId);
            }
        }
    });
    isReady.notifications = true;
});

Template.roomView.destroyed = function () {
    isReady.notifications = false;
    isReady.messages = false;
};
