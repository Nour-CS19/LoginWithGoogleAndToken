import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../Pages/AuthPage';
import * as signalR from '@microsoft/signalr';
import { Send, Paperclip, Users, Wifi, WifiOff, AlertCircle, CheckCircle } from 'lucide-react';

const ChatApp = () => {
  const { user, logout } = useAuth(); 
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [connectionError, setConnectionError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [userPhotos, setUserPhotos] = useState({});
  const [isTyping, setIsTyping] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [authError, setAuthError] = useState(null); 
  
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const connectionRef = useRef(null);
  const retryCountRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  const maxRetries = 5;

  const capitalizeRole = useCallback(role => 
    role?.charAt(0).toUpperCase() + role.slice(1).toLowerCase() || 'Unknown', []);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  // Enhanced photo fetching with caching and authorization
  const fetchUserPhoto = useCallback(async (fileName, role, userId, isChat = false) => {
    if (!fileName || !user?.accessToken) {
      setUserPhotos(prev => ({ ...prev, [userId]: null }));
      return;
    }

    if (userPhotos[userId] && !userPhotos[userId].startsWith('blob:')) {
      return;
    }

    const path = isChat ? 'Chat' : `Actors/${capitalizeRole(role)}`;
    const url = `https://physiocareapp.runasp.net/api/v1/Upload/image?filename=${encodeURIComponent(fileName)}&path=${encodeURIComponent(path)}`;
    
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 
          Authorization: `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json' 
        },
      });
      
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setAuthError('Authentication failed. Please re-authenticate.');
          return;
        }
        throw new Error(`HTTP error! Status: ${res.status}`);
      }
      
      const blob = await res.blob();
      const imgUrl = URL.createObjectURL(blob);
      setUserPhotos(prev => ({ ...prev, [userId]: imgUrl }));
    } catch (err) {
      console.error(`Image fetch error for ${userId}:`, err);
      setUserPhotos(prev => ({ ...prev, [userId]: null }));
    }
  }, [user?.accessToken, capitalizeRole, userPhotos]);

  const initializeSignalR = useCallback(async () => {
    if (!user?.accessToken || !user?.id) {
      console.warn('Missing access token or user ID, skipping SignalR initialization');
      setAuthError('Missing authentication. Please log in.');
      return;
    }

    if (connectionRef.current?.state === signalR.HubConnectionState.Connected) {
      return;
    }

    if (connectionRef.current) {
      try {
        await connectionRef.current.stop();
      } catch (e) {
        console.warn('Error stopping existing connection:', e);
      }
      connectionRef.current = null;
    }

    setConnectionStatus('connecting');
    setConnectionError(null);
    setAuthError(null);
    
    const transportTypes = [
      signalR.HttpTransportType.WebSockets,
      signalR.HttpTransportType.ServerSentEvents,
      signalR.HttpTransportType.LongPolling
    ];

    for (let i = 0; i < transportTypes.length; i++) {
      const transport = transportTypes[i];
      
      try {
        console.log(`Attempting connection with transport: ${transport}`);
        
        const connection = new signalR.HubConnectionBuilder()
          .withUrl('https://physiocareapp.runasp.net/chatHub', {
            accessTokenFactory: () => user.accessToken,
            headers: {
              'Authorization': `Bearer ${user.accessToken}`
            }
          })
          .withAutomaticReconnect({
            nextRetryDelayInMilliseconds: retryContext => {
              if (retryContext.previousRetryCount < 3) {
                return Math.random() * 10000;
              } else {
                return null;
              }
            }
          })
          .configureLogging(signalR.LogLevel.Information)
          .build();

        connectionRef.current = connection;

        setupConnectionHandlers(connection);

        const connectionPromise = connection.start();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Connection timeout')), 10000);
        });

        await Promise.race([connectionPromise, timeoutPromise]);
        
        setConnectionStatus('connected');
        setConnectionError(null);
        retryCountRef.current = 0;
        console.log(`Successfully connected with transport: ${transport}`);
        return;
        
      } catch (err) {
        console.error(`Connection failed with transport ${transport}:`, err);
        if (err.message.includes('401') || err.message.includes('403')) {
          setAuthError('Authentication failed for SignalR. Please re-authenticate.');
          break;
        }
        
        if (connectionRef.current) {
          try {
            await connectionRef.current.stop();
          } catch (e) {
            console.warn('Error stopping failed connection:', e);
          }
          connectionRef.current = null;
        }
      }
    }

    setConnectionStatus('disconnected');
    setConnectionError('Failed to connect using any transport method. Please check your network connection.');
    retryCountRef.current++;

    if (retryCountRef.current < maxRetries) {
      const retryDelay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
      console.log(`Scheduling retry ${retryCountRef.current} in ${retryDelay}ms`);
      setTimeout(() => {
        if (retryCountRef.current < maxRetries) {
          initializeSignalR();
        }
      }, retryDelay);
    }
  }, [user?.accessToken, user?.id]);

  // Setup connection event handlers
  const setupConnectionHandlers = useCallback((connection) => {
    connection.on('ReceiveMessage', (senderId, recipientId, messageText, date, fileName) => {
      console.log('Received message:', { senderId, recipientId, messageText, date, fileName });
      
      const newMessage = {
        id: `${Date.now()}-${Math.random()}`,
        text: messageText || '',
        senderId,
        recipientId,
        date: date || new Date().toISOString(),
        file: fileName || null,
      };

      setMessages(prev => {
        const exists = prev.find(m => 
          m.senderId === senderId && 
          m.recipientId === recipientId && 
          m.text === messageText && 
          Math.abs(new Date(m.date) - new Date(date)) < 1000
        );
        
        if (exists) return prev;
        
        const updated = [...prev, newMessage];
        return updated.sort((a, b) => new Date(a.date) - new Date(b.date));
      });

      if (fileName) {
        fetchUserPhoto(fileName, '', newMessage.id + '-chat', true);
      }
    });

    connection.on('UserStatusChanged', (userId, status) => {
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, lastActive: status } : u))
      );
      
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        if (status === 'online') {
          newSet.add(userId);
        } else {
          newSet.delete(userId);
        }
        return newSet;
      });
    });

    connection.on('updateuserlist', (userList) => {
      console.log('Received updateuserlist:', userList);
      
      if (Array.isArray(userList)) {
        const mappedUsers = userList.map(u => ({
          id: u.userId || u.id || u.UserId || u.Id,
          name: u.fullName || u.userName || u.FullName || u.UserName || 'Unknown',
          role: u.role || u.Role || 'unknown',
          fileName: u.fileName || u.FileName || null,
          lastActive: u.lastActive || u.LastActive || 'offline',
        }));
        
        setUsers(prev => {
          const existingIds = new Set(prev.map(u => u.id));
          const newUsers = mappedUsers.filter(u => !existingIds.has(u.id));
          const updatedUsers = prev.map(u => {
            const updated = mappedUsers.find(nu => nu.id === u.id);
            return updated || u;
          });
          return [...updatedUsers, ...newUsers];
        });
        
        mappedUsers.forEach(u => {
          if (u.lastActive === 'online') {
            setOnlineUsers(prev => new Set([...prev, u.id]));
          }
          fetchUserPhoto(u.fileName, u.role, u.id);
        });
      }
    });

    connection.onreconnecting(() => {
      console.log('Connection is reconnecting...');
      setConnectionStatus('reconnecting');
      setConnectionError(null);
    });

    connection.onreconnected(() => {
      console.log('Connection reconnected successfully');
      setConnectionStatus('connected');
      setConnectionError(null);
      retryCountRef.current = 0;
    });

    connection.onclose(async (error) => {
      console.error('Connection closed:', error);
      setConnectionStatus('disconnected');
      
      if (error) {
        setConnectionError(`Connection lost: ${error.message || 'Unknown error'}`);
        if (error.message.includes('401') || error.message.includes('403')) {
          setAuthError('Authentication failed. Please re-authenticate.');
        }
        
        if (retryCountRef.current < maxRetries) {
          setTimeout(() => {
            console.log('Attempting to reconnect after connection close...');
            initializeSignalR();
          }, 5000);
        }
      }
    });
  }, [fetchUserPhoto, initializeSignalR]);

  const handleManualReconnect = useCallback(async () => {
    retryCountRef.current = 0;
    await initializeSignalR();
  }, [initializeSignalR]);

  // Fetch chat users with improved error handling and authorization
  const fetchChatUsers = useCallback(async () => {
    if (!user?.accessToken || !user?.id) return;
    
    setIsLoading(true);
    const role = user.role?.toLowerCase() || 'patient';
    let rolesToFetch = [];

    if (role === 'patient') {
      rolesToFetch = ['doctor', 'nurse', 'laboratory'];
    } else {
      rolesToFetch = ['patient'];
    }

    try {
      const chatRes = await fetch(
        `https://physiocareapp.runasp.net/api/v1/Message/get-all-users-chatting-with-current-users?CurrentUserId=${user.id}`,
        { 
          headers: { Authorization: `Bearer ${user.accessToken}` },
          timeout: 10000
        }
      );
      
      if (!chatRes.ok) {
        if (chatRes.status === 401 || chatRes.status === 403) {
          setAuthError('Authentication failed. Please re-authenticate.');
          return;
        }
        throw new Error(`HTTP error! Status: ${chatRes.status}`);
      }
      
      let chatData = [];
      try {
        chatData = await chatRes.json();
      } catch (e) {
        console.warn('Invalid JSON from chat users endpoint');
      }
      
      const chattedUserIds = new Set(chatData.map(u => u.userId || u.id));

      const rolePromises = rolesToFetch.map(async r => {
        try {
          const res = await fetch(
            `https://physiocareapp.runasp.net/api/v1/Admins/get-all-basic-info-users-by-role?role=${r}`,
            { 
              headers: { Authorization: `Bearer ${user.accessToken}` },
              timeout: 10000
            }
          );
          
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              setAuthError('Authentication failed. Please re-authenticate.');
              return [];
            }
            throw new Error(`HTTP error! Status: ${res.status}`);
          }
          
          const data = await res.json();
          return Array.isArray(data)
            ? data
                .filter(u => u.lastActive === 'online' || chattedUserIds.has(u.userId || u.id))
                .map(u => ({ ...u, role: r }))
            : [];
        } catch (err) {
          console.error(`Error fetching ${r} users:`, err);
          return [];
        }
      });

      const allUsers = (await Promise.all(rolePromises)).flat();
      const mapped = allUsers.map(u => ({
        id: u.userId || u.id,
        name: u.fullName || u.userName || 'Unknown',
        role: u.role,
        fileName: u.fileName || null,
        lastActive: u.lastActive || 'offline',
      }));

      setUsers(mapped);
      const onlineUserIds = mapped.filter(u => u.lastActive === 'online').map(u => u.id);
      setOnlineUsers(new Set(onlineUserIds));
      mapped.forEach(u => fetchUserPhoto(u.fileName, u.role, u.id));
      
    } catch (err) {
      console.error('fetchChatUsers error:', err);
      if (err.message.includes('401') || err.message.includes('403')) {
        setAuthError('Authentication failed. Please re-authenticate.');
      } else {
        setConnectionError('Failed to load chat users');
      }
    } finally {
      setIsLoading(false);
    }
  }, [user?.accessToken, user?.id, user?.role, fetchUserPhoto]);

  const fetchMessages = useCallback(async (recipientId) => {
    if (!user?.accessToken || !user?.id || !recipientId) return;

    setIsLoading(true);
    
    try {
      const [senderRes, recipientRes] = await Promise.all([
        fetch(
          `https://physiocareapp.runasp.net/api/v1/Message/get-all-messages-by-sender-id-and-recipient-id?senderId=${user.id}&recipientId=${recipientId}`,
          { 
            headers: { Authorization: `Bearer ${user.accessToken}` },
            timeout: 10000
          }
        ),
        fetch(
          `https://physiocareapp.runasp.net/api/v1/Message/get-all-messages-by-sender-id-and-recipient-id?senderId=${recipientId}&recipientId=${user.id}`,
          { 
            headers: { Authorization: `Bearer ${user.accessToken}` },
            timeout: 10000
          }
        )
      ]);

      if (!senderRes.ok || !recipientRes.ok) {
        if (senderRes.status === 401 || senderRes.status === 403 || recipientRes.status === 401 || recipientRes.status === 403) {
          setAuthError('Authentication failed. Please re-authenticate.');
          return;
        }
        throw new Error(`HTTP error! Status: ${senderRes.status || recipientRes.status}`);
      }

      let senderData = [], recipientData = [];
      
      try {
        senderData = await senderRes.json();
      } catch (e) {
        console.warn('Invalid JSON from sender messages');
      }
      
      try {
        recipientData = await recipientRes.json();
      } catch (e) {
        console.warn('Invalid JSON from recipient messages');
      }

      const allMessages = [...senderData, ...recipientData];
      const uniqueMessages = allMessages.filter((msg, index, self) => 
        index === self.findIndex(m => m.id === msg.id)
      );

      const formatted = await Promise.all(
        uniqueMessages.map(async m => {
          if (m.fileName) {
            await fetchUserPhoto(m.fileName, '', m.id + '-chat', true);
          }
          return {
            id: m.id,
            text: m.messageText || '',
            senderId: m.senderId,
            recipientId: m.recipientId,
            date: m.date || new Date().toISOString(),
            file: m.fileName,
          };
        })
      );
      
      setMessages(formatted.sort((a, b) => new Date(a.date) - new Date(b.date)));
    } catch (err) {
      console.error('fetchMessages error:', err);
      if (err.message.includes('401') || err.message.includes('403')) {
        setAuthError('Authentication failed. Please re-authenticate.');
      } else {
        setConnectionError('Failed to load messages');
      }
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.accessToken, user?.id, fetchUserPhoto]);

  const handleSendMessage = useCallback(async () => {
    if (!user?.accessToken || !selectedUser || (!message.trim() && !file)) return;

    const messageText = message.trim();
    const tempId = `temp-${Date.now()}`;
    
    const optimisticMessage = {
      id: tempId,
      text: messageText,
      senderId: user.id,
      recipientId: selectedUser.id,
      date: new Date().toISOString(),
      file: file ? file.name : null,
      sending: true,
    };
    
    setMessages(prev => [...prev, optimisticMessage]);
    
    setMessage('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    const formData = new FormData();
    formData.append('SenderId', user.id);
    formData.append('RecipientId', selectedUser.id);
    formData.append('Date', new Date().toISOString());
    formData.append('MessageText', messageText);
    formData.append('UserName', user.name || user.userName);
    if (file) formData.append('ImageFile', file);

    try {
      const res = await fetch('https://physiocareapp.runasp.net/api/v1/Chat/sendmessage', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${user.accessToken}` 
        },
        body: formData,
      });
      
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setAuthError('Authentication failed. Please re-authenticate.');
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, failed: true, sending: false } : m));
          return;
        }
        throw new Error(`HTTP error! Status: ${res.status}`);
      }
      
      const data = await res.json();
      
      setMessages(prev => prev.map(m => 
        m.id === tempId ? { ...m, id: data.id || tempId, sending: false } : m
      ));

      if (connectionRef.current?.state === signalR.HubConnectionState.Connected) {
        try {
          await connectionRef.current.invoke(
            'SendMessage', 
            user.id, 
            selectedUser.id, 
            messageText, 
            new Date().toISOString(), 
            file ? file.name : null
          );
        } catch (signalRError) {
          console.warn('SignalR send failed, but HTTP send succeeded:', signalRError);
        }
      }
    } catch (err) {
      console.error('Send error:', err);
      setMessages(prev => prev.map(m => 
        m.id === tempId ? { ...m, failed: true, sending: false } : m
      ));
      if (err.message.includes('401') || err.message.includes('403')) {
        setAuthError('Authentication failed. Please re-authenticate.');
      } else {
        setConnectionError('Failed to send message');
      }
    }
  }, [user, selectedUser, message, file]);

  // Handle typing indicator
  const handleTyping = useCallback(() => {
    if (!isTyping) {
      setIsTyping(true);
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000);

    if (connectionRef.current?.state === signalR.HubConnectionState.Connected) {
      connectionRef.current.invoke('SendTyping', user.id, selectedUser.id);
    }
  }, [isTyping]);

  // Handle Enter key for sending
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  // Initialize component
  useEffect(() => {
    if (user?.id && user?.accessToken) {
      fetchChatUsers();
      setTimeout(() => {
        initializeSignalR();
      }, 1000);
    } else {
      setAuthError('Please log in to continue.');
    }

    return () => {
      if (connectionRef.current) {
        connectionRef.current.stop().catch(console.error);
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [user?.id, user?.accessToken, fetchChatUsers, initializeSignalR]);

  // Fetch messages when user is selected
  useEffect(() => {
    if (selectedUser) {
      fetchMessages(selectedUser.id);
    }
  }, [selectedUser, fetchMessages]);

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom]);

  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <CheckCircle size={16} className="text-success" />;
      case 'connecting':
      case 'reconnecting':
        return <AlertCircle size={16} className="text-warning" />;
      case 'disconnected':
      default:
        return <WifiOff size={16} className="text-danger" />;
    }
  };

  const getConnectionText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'reconnecting':
        return 'Reconnecting...';
      case 'disconnected':
      default:
        return retryCountRef.current >= maxRetries ? 'Connection Failed' : 'Disconnected';
    }
  };

  return (
    <div className="container-fluid h-100 p-0">
      <div className="row h-100 g-0">
        {/* Sidebar */}
        <div className="col-md-4 col-lg-3 bg-white border-end d-flex flex-column">
          {/* Header */}
          <div className="p-3 border-bottom bg-light">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                <Users size={20} className="text-primary me-2" />
                <h5 className="mb-0 fw-bold">Chats</h5>
              </div>
              <div className="d-flex align-items-center">
                {getConnectionIcon()}
                <small className="text-muted ms-2">{getConnectionText()}</small>
                {connectionStatus === 'disconnected' && retryCountRef.current < maxRetries && (
                  <button 
                    className="btn btn-sm btn-outline-primary ms-2"
                    onClick={handleManualReconnect}
                    disabled={connectionStatus === 'connecting'}
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Users List */}
          <div className="flex-fill overflow-auto">
            {isLoading ? (
              <div className="p-4 text-center text-muted">
                <div className="spinner-border spinner-border-sm me-2" role="status"></div>
                Loading users...
              </div>
            ) : users.length === 0 ? (
              <div className="p-4 text-center text-muted">No users available</div>
            ) : (
              <div className="list-group list-group-flush">
                {users.map(u => (
                  <div
                    key={u.id}
                    className={`list-group-item list-group-item-action d-flex align-items-center p-3 ${
                      selectedUser?.id === u.id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedUser(u)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="position-relative me-3">
                      <img
                        src={userPhotos[u.id] || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=e9ecef&color=495057`}
                        alt={`${u.name}'s avatar`}
                        className="rounded-circle border"
                        style={{ width: '48px', height: '48px', objectFit: 'cover' }}
                      />
                      {onlineUsers.has(u.id) && (
                        <span className="position-absolute bottom-0 end-0 translate-middle p-1 bg-success border border-light rounded-circle">
                          <span className="visually-hidden">Online</span>
                        </span>
                      )}
                    </div>
                    <div className="flex-fill min-w-0">
                      <div className="d-flex justify-content-between align-items-center">
                        <h6 className="mb-0 text-truncate fw-semibold">
                          {u.name}
                        </h6>
                        {onlineUsers.has(u.id) && (
                          <small className="text-success fw-bold">Online</small>
                        )}
                      </div>
                      <small className="text-muted text-capitalize">{u.role}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="col-md-8 col-lg-9 d-flex flex-column">
          {selectedUser ? (
            <>
              {/* Chat Header */}
              <div className="p-3 bg-white border-bottom">
                <div className="d-flex align-items-center">
                  <div className="position-relative me-3">
                    <img
                      src={userPhotos[selectedUser.id] || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedUser.name)}&background=e9ecef&color=495057`}
                      alt={`${selectedUser.name}'s avatar`}
                      className="rounded-circle"
                      style={{ width: '40px', height: '40px', objectFit: 'cover' }}
                    />
                    {onlineUsers.has(selectedUser.id) && (
                      <span className="position-absolute bottom-0 end-0 translate-middle p-1 bg-success border border-light rounded-circle">
                        <span className="visually-hidden">Online</span>
                      </span>
                    )}
                  </div>
                  <div>
                    <h6 className="mb-0 fw-bold">{selectedUser.name}</h6>
                    <small className="text-muted text-capitalize">
                      {selectedUser.role} • {onlineUsers.has(selectedUser.id) ? 'Online' : 'Offline'}
                    </small>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-fill overflow-auto p-3" style={{ backgroundColor: '#f8f9fa' }}>
                {isLoading ? (
                  <div className="text-center text-muted">
                    <div className="spinner-border spinner-border-sm me-2" role="status"></div>
                    Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-muted">
                    <Users size={48} className="mb-3 opacity-50" />
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {messages.map(m => (
                      <div
                        key={m.id}
                        className={`d-flex ${m.senderId === user.id ? 'justify-content-end' : 'justify-content-start'}`}
                      >
                        <div
                          className={`card border-0 shadow-sm ${
                            m.senderId === user.id
                              ? 'bg-primary text-white'
                              : 'bg-white'
                          } ${m.sending ? 'opacity-75' : ''} ${m.failed ? 'border-danger' : ''}`}
                          style={{ maxWidth: '70%' }}
                        >
                          <div className="card-body p-3">
                            {m.text && <p className="card-text mb-2">{m.text}</p>}
                            {m.file && (
                              <div className="mt-2">
                                <img
                                  src={userPhotos[m.id + '-chat'] || 'https://via.placeholder.com/200x150'}
                                  alt="attachment"
                                  className="img-fluid rounded"
                                  style={{ maxHeight: '200px' }}
                                />
                              </div>
                            )}
                            <div className={`small mt-2 ${
                              m.senderId === user.id ? 'text-white-50' : 'text-muted'
                            }`}>
                              {new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {m.sending && (
                                <>
                                  <span className="mx-1">•</span>
                                  <span className="fst-italic">Sending...</span>
                                </>
                              )}
                              {m.failed && (
                                <>
                                  <span className="mx-1">•</span>
                                  <span className="text-danger fst-italic">Failed to send</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Input */}
              <div className="p-3 bg-white border-top">
                <div className="input-group">
                  <input
                    type="text"
                    className="form-control"
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      handleTyping();
                    }}
                    onKeyPress={handleKeyPress}
                    placeholder="Type a message..."
                    disabled={connectionStatus === 'disconnected' && retryCountRef.current >= maxRetries || authError}
                  />
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    className="form-control d-none"
                    onChange={(e) => setFile(e.target.files[0])}
                    id="fileInput"
                    disabled={authError}
                  />
                  <button
                    className="btn btn-outline-secondary"
                    type="button"
                    onClick={() => fileInputRef.current.click()}
                    disabled={connectionStatus === 'disconnected' && retryCountRef.current >= maxRetries || authError}
                  >
                    <Paperclip size={16} />
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSendMessage}
                    disabled={connectionStatus === 'disconnected' && retryCountRef.current >= maxRetries || !message.trim() && !file || authError}
                  >
                    <Send size={16} />
                  </button>
                </div>
                {isTyping && (
                  <small className="text-muted mt-1">Recipient is typing...</small>
                )}
                {authError && (
                  <div className="text-danger mt-1">
                    {authError}
                    <button 
                      className="btn btn-sm btn-danger ms-2"
                      onClick={logout}
                    >
                      Re-authenticate
                    </button>
                  </div>
                )}
                {connectionError && !authError && (
                  <div className="text-danger mt-1">{connectionError}</div>
                )}
              </div>
            </>
          ) : (
            <div className="d-flex flex-column justify-content-center align-items-center flex-fill text-muted">
              <Users size={64} className="mb-3 opacity-50" />
              <h5>Select a user to start chatting</h5>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatApp;