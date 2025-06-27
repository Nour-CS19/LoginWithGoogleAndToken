import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../Pages/AuthPage';
import * as signalR from '@microsoft/signalr';

const ChatApp = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [reconnectStatus, setReconnectStatus] = useState('');
  const [userPhotos, setUserPhotos] = useState({});
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const connectionRef = useRef(null);
  const retryCountRef = useRef(0);

  const capitalizeRole = role => role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();

  // Initialize SignalR connection with reconnection logic
  const initializeSignalR = async () => {
    if (!user?.accessToken || !user?.id) {
      console.warn('Missing access token or user ID, skipping SignalR initialization at', new Date().toISOString());
      return;
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl('https://physiocareapp.runasp.net/chatHub', {
        accessTokenFactory: () => user.accessToken,
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 15000])
      .configureLogging(signalR.LogLevel.Information)
      .build();

    connectionRef.current = connection;

    connection.on('ReceiveMessage', (senderId, recipientId, messageText, date, fileName) => {
      console.log('Received message at', new Date().toISOString(), ':', { senderId, recipientId, messageText, date, fileName });
      if (
        (senderId === selectedUser?.id && recipientId === user.id) ||
        (senderId === user.id && recipientId === selectedUser?.id)
      ) {
        const newMessage = {
          id: Date.now().toString(),
          text: messageText || 'No text',
          senderId,
          recipientId,
          date: date || new Date().toISOString(),
          file: fileName || null,
        };
        setMessages(prev => [...prev, newMessage].sort((a, b) => new Date(a.date) - new Date(b.date)));
        if (fileName) fetchUserPhoto(fileName, '', newMessage.id + '-chat', true);
      }
    });

    connection.on('UserStatusChanged', (userId, status) => {
      setUsers(prev =>
        prev.map(u => (u.id === userId ? { ...u, lastActive: status } : u))
      );
    });

    connection.on('updateuserlist', (userList) => {
      console.log('Received updateuserlist at', new Date().toISOString(), ':', userList);
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
        mappedUsers.forEach(u => fetchUserPhoto(u.fileName, u.role, u.id));
      } else {
        console.warn('updateuserlist payload is not an array at', new Date().toISOString(), ':', userList);
      }
    });

    connection.onclose(async (error) => {
      console.error('Connection closed at', new Date().toISOString(), ':', error);
      setConnectionError('Connection lost.');
      setReconnectStatus(`Attempting to reconnect (Attempt ${retryCountRef.current + 1})...`);
      await reconnectSignalR();
    });

    try {
      await connection.start();
      console.log('SignalR connected at', new Date().toISOString());
      setConnectionError(null);
      setReconnectStatus('');
      retryCountRef.current = 0;
    } catch (err) {
      console.error('SignalR connection error at', new Date().toISOString(), ':', err);
      if (err.message.includes('NetworkError')) {
        console.warn('Network error detected, check server availability or network connection at', new Date().toISOString());
      }
      setConnectionError('Failed to connect to real-time chat. Network issue detected.');
      setReconnectStatus(`Attempting to reconnect (Attempt ${retryCountRef.current + 1})...`);
      await reconnectSignalR();
    }
  };

  const reconnectSignalR = async () => {
    if (connectionRef.current?.state === signalR.HubConnectionState.Disconnected) {
      retryCountRef.current += 1;
      const delay = Math.min(15000, 2000 * Math.pow(2, retryCountRef.current));
      console.log(
        `Retrying connection in ${delay / 1000} seconds (attempt ${retryCountRef.current}) at`,
        new Date().toISOString()
      );
      setReconnectStatus(`Attempting to reconnect (Attempt ${retryCountRef.current})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        await connectionRef.current.start();
        console.log('SignalR reconnected at', new Date().toISOString());
        setConnectionError(null);
        setReconnectStatus('');
        retryCountRef.current = 0;
      } catch (err) {
        console.error('Reconnection failed at', new Date().toISOString(), ':', err);
        if (err.message.includes('NetworkError')) {
          console.warn('Network error persists, server may be unavailable at', new Date().toISOString());
        }
        setConnectionError(`Reconnection failed. Network issue detected.`);
        setReconnectStatus(`Attempting to reconnect (Attempt ${retryCountRef.current + 1})...`);
        await reconnectSignalR();
      }
    }
  };

  const fetchUserPhoto = async (fileName, role, userId, isChat = false) => {
    if (!fileName || !user?.accessToken) {
      setUserPhotos(prev => ({ ...prev, [userId]: 'https://via.placeholder.com/40' }));
      console.warn(`No fileName or accessToken for user ${userId} at ${new Date().toISOString()}, using fallback image`);
      return;
    }
    const path = isChat ? 'Chat' : `Actors/${capitalizeRole(role)}`;
    const url = `https://physiocareapp.runasp.net/api/v1/Upload/image?filename=${encodeURIComponent(fileName)}&path=${encodeURIComponent(path)}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      if (res.ok) {
        const blob = await res.blob();
        const imgUrl = URL.createObjectURL(blob);
        setUserPhotos(prev => ({ ...prev, [userId]: imgUrl }));
      } else {
        console.warn(`Photo fetch failed for ${userId} at ${new Date().toISOString()}: ${res.status} ${res.statusText}`);
        setUserPhotos(prev => ({ ...prev, [userId]: 'https://via.placeholder.com/40' }));
      }
    } catch (err) {
      console.error(`Image fetch error for ${userId} at ${new Date().toISOString()}:`, err);
      setConnectionError('Network issue detected while fetching images.');
      setUserPhotos(prev => ({ ...prev, [userId]: 'https://via.placeholder.com/40' }));
    }
  };

  const fetchChatUsers = async () => {
    if (!user?.accessToken || !user?.id) return;
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
        }
      );
      if (!chatRes.ok) throw new Error(`HTTP error! status: ${chatRes.status}`);
      let chatData = await chatRes.json().catch(err => {
        console.error('Invalid JSON from chat users endpoint at', new Date().toISOString(), ':', err);
        return [];
      });
      const chattedUserIds = new Set(chatData.map(u => u.userId || u.id));

      const rolePromises = rolesToFetch.map(async r => {
        const res = await fetch(
          `https://physiocareapp.runasp.net/api/v1/Admins/get-all-basic-info-users-by-role?role=${r}`,
          {
            headers: { Authorization: `Bearer ${user.accessToken}` },
          }
        );
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        let data = await res.json().catch(err => {
          console.error(`Invalid JSON from role ${r} endpoint at`, new Date().toISOString(), ':', err);
          return [];
        });
        return Array.isArray(data)
          ? data
              .filter(u => u.lastActive === 'online' || chattedUserIds.has(u.userId || u.id))
              .map(u => ({ ...u, role: r }))
          : [];
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
      mapped.forEach(u => fetchUserPhoto(u.fileName, u.role, u.id));
    } catch (err) {
      console.error('fetchChatUsers error at', new Date().toISOString(), ':', err);
      if (err.message.includes('NetworkError')) {
        setConnectionError('Network issue detected while loading chat users.');
      } else {
        setConnectionError('Failed to load chat users. Check server response.');
      }
      setUsers([]);
    }
  };

  const fetchMessages = async recipientId => {
    if (!user?.accessToken || !user?.id || !recipientId) return;

    try {
      // First attempt: Fetch messages with you as sender
      let res = await fetch(
        `https://physiocareapp.runasp.net/api/v1/Message/get-all-messages-by-sender-id-and-recipient-id?senderId=${user.id}&recipientId=${recipientId}`,
        {
          headers: { Authorization: `Bearer ${user.accessToken}` },
        }
      );
      let data = await res.json().catch(err => {
        console.error('Invalid JSON from messages endpoint (sender) at', new Date().toISOString(), ':', err);
        return [];
      });

      // If no messages or only your messages, fetch with other user as sender
      if (!data.length || data.every(m => m.senderId === user.id)) {
        console.warn('No messages or only sender messages, fetching with reversed IDs at', new Date().toISOString());
        res = await fetch(
          `https://physiocareapp.runasp.net/api/v1/Message/get-all-messages-by-sender-id-and-recipient-id?senderId=${recipientId}&recipientId=${user.id}`,
          {
            headers: { Authorization: `Bearer ${user.accessToken}` },
          }
        );
        if (!res.ok) throw new Error(`HTTP error for reversed fetch! status: ${res.status}`);
        data = await res.json().catch(err => {
          console.error('Invalid JSON from messages endpoint (recipient) at', new Date().toISOString(), ':', err);
          return [];
        });
      }

      console.log('Fetched messages at', new Date().toISOString(), ':', data.map(m => ({ senderId: m.senderId, text: m.messageText, date: m.date })));
      const formatted = await Promise.all(
        data.map(async m => {
          if (m.fileName) await fetchUserPhoto(m.fileName, '', m.id + '-chat', true);
          return {
            id: m.id,
            text: m.messageText || 'No text',
            senderId: m.senderId,
            recipientId: m.recipientId,
            date: m.date || new Date().toISOString(),
            file: m.fileName,
          };
        })
      );
      setMessages(formatted.sort((a, b) => new Date(a.date) - new Date(b.date)));
    } catch (err) {
      console.error('fetchMessages error at', new Date().toISOString(), ':', err);
      if (err.message.includes('NetworkError')) {
        setConnectionError('Network issue detected while loading messages.');
      } else {
        setConnectionError('Failed to load messages.');
      }
      setMessages([]);
    }
  };

  const handleSendMessage = async () => {
    if (!user?.accessToken || !selectedUser || (!message.trim() && !file)) return;

    const formData = new FormData();
    formData.append('SenderId', user.id);
    formData.append('RecipientId', selectedUser.id);
    formData.append('Date', new Date().toISOString()); // Current time for sent message
    formData.append('MessageText', message);
    formData.append('UserName', user.name || user.userName);
    if (file) formData.append('ImageFile', file);

    try {
      const res = await fetch('https://physiocareapp.runasp.net/api/v1/Chat/sendmessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
        body: formData,
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json().catch(err => {
        console.error('Invalid response from sendmessage at', new Date().toISOString(), ':', err);
        return {};
      });
      console.log('Message sent at', new Date().toISOString(), ':', data);

      // Immediately update local state for real-time feel
      const newMessage = {
        id: Date.now().toString(),
        text: message,
        senderId: user.id,
        recipientId: selectedUser.id,
        date: new Date().toISOString(),
        file: file ? file.name : null,
      };
      setMessages(prev => [...prev, newMessage].sort((a, b) => new Date(a.date) - new Date(b.date)));
      setMessage('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Notify via SignalR if connected
      if (connectionRef.current?.state === signalR.HubConnectionState.Connected) {
        await connectionRef.current.invoke('SendMessage', user.id, selectedUser.id, message, new Date().toISOString(), file ? file.name : null);
      }
    } catch (err) {
      console.error('Send error at', new Date().toISOString(), ':', err);
      if (err.message.includes('NetworkError')) {
        setConnectionError('Network issue detected while sending message.');
      } else {
        setConnectionError('Failed to send message. Check connection or server.');
      }
    }
  };

  useEffect(() => {
    fetchChatUsers();
    initializeSignalR();
    console.log('Component mounted, user:', user?.id, 'at', new Date().toISOString());

    return () => {
      if (connectionRef.current) {
        connectionRef.current.stop().catch(err =>
          console.error('SignalR disconnect error at', new Date().toISOString(), ':', err)
        );
        console.log('SignalR disconnected at', new Date().toISOString());
      }
    };
  }, [user?.id, user?.accessToken]);

  useEffect(() => {
    if (selectedUser) fetchMessages(selectedUser.id);
  }, [selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div
      style={{
        display: 'flex',
        padding: '20px',
        height: '100vh',
        backgroundColor: '#f5f5f5',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: '33%',
          borderRight: '1px solid #ddd',
          paddingRight: '20px',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 40px)',
        }}
      >
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px' }}>Chat Users</h3>
        {users.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No users available.</p>
        ) : (
          users.map(u => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '10px',
                cursor: 'pointer',
                backgroundColor: selectedUser?.id === u.id ? '#e0e0e0' : 'transparent',
                borderRadius: '5px',
                marginBottom: '5px',
                transition: 'background-color 0.2s',
              }}
              onClick={() => setSelectedUser(u)}
              onMouseOver={e => (e.target.style.backgroundColor = '#d3d3d3')}
              onMouseOut={e =>
                (e.target.style.backgroundColor = selectedUser?.id === u.id ? '#e0e0e0' : 'transparent')
              }
            >
              <img
                src={userPhotos[u.id] || 'https://via.placeholder.com/40'}
                alt={`${u.name}'s avatar`}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  marginRight: '10px',
                  objectFit: 'cover',
                  border: '1px solid #ccc',
                }}
              />
              <div>
                <p style={{ fontSize: '14px', fontWeight: '500', margin: '0' }}>{u.name} ({u.role})</p>
                {u.lastActive === 'online' && <span style={{ color: 'green', fontSize: '12px' }}>●</span>}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ flex: '1', paddingLeft: '20px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px' }}>Messages</h3>
        {selectedUser ? (
          <>
            <div
              style={{
                height: '400px',
                overflowY: 'auto',
                border: '1px solid #ddd',
                padding: '15px',
                backgroundColor: '#fff',
                borderRadius: '5px',
                maxHeight: 'calc(100vh - 200px)',
              }}
            >
              {messages.length === 0 ? (
                <p style={{ color: '#888', fontStyle: 'italic' }}>No messages yet.</p>
              ) : (
                messages.map(m => (
                  <div
                    key={m.id}
                    style={{
                      marginBottom: '15px',
                      display: 'flex',
                      justifyContent: m.senderId === user.id ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '70%',
                        padding: '10px',
                        borderRadius: '5px',
                        backgroundColor: m.senderId === user.id ? '#007bff' : '#e9ecef',
                        color: m.senderId === user.id ? '#fff' : '#000',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        wordWrap: 'break-word',
                      }}
                    >
                      <p style={{ margin: '0' }}>{m.text || 'No text'}</p>
                      {m.file && (
                        <div style={{ marginTop: '10px' }}>
                          <img
                            src={userPhotos[m.id + '-chat'] || 'https://via.placeholder.com/150'}
                            alt="attachment"
                            style={{
                              maxHeight: '150px',
                              borderRadius: '5px',
                              objectFit: 'cover',
                              border: '1px solid #ddd',
                            }}
                          />
                        </div>
                      )}
                      <div style={{ fontSize: '12px', marginTop: '5px', opacity: '0.7' }}>
                        {new Date(m.date).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ marginTop: '15px', display: 'flex', alignItems: 'center' }}>
              <input
                type="text"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Type your message"
                style={{
                  flex: '2',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '5px 0 0 5px',
                  outline: 'none',
                  fontSize: '14px',
                }}
              />
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={e => setFile(e.target.files[0])}
                style={{
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderLeft: 'none',
                  borderRadius: '0 5px 5px 0',
                  marginLeft: '-1px',
                  fontSize: '14px',
                }}
              />
              <button
                onClick={handleSendMessage}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#007bff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0 5px 5px 0',
                  cursor: 'pointer',
                  marginLeft: '-1px',
                  fontSize: '14px',
                }}
                onMouseOver={e => (e.target.style.backgroundColor = '#0056b3')}
                onMouseOut={e => (e.target.style.backgroundColor = '#007bff')}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: '#888', fontStyle: 'italic' }}>Select a user to view messages.</p>
        )}

        {(connectionError || reconnectStatus) && (
          <div style={{ marginTop: '15px', color: '#dc3545', fontSize: '14px' }}>
            {connectionError || 'Connected.'} {reconnectStatus}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatApp;