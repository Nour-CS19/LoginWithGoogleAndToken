/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthPage'; // Ensure this path is correct
import 'bootstrap/dist/css/bootstrap.min.css';
import bg from './mockuuups-iphone-15-pro-mockup-on-a-white-modern-table.jpeg';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth(); // This will throw error if not in AuthProvider
  console.log('Auth context available in LoginPage:', !!useAuth()); // Debug log

  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleInitialized, setGoogleInitialized] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  const GOOGLE_CLIENT_ID =
    process.env.REACT_APP_GOOGLE_CLIENT_ID || '318210078663-qfbsl8qbnniu3dqqq2sun50vdu5f5pj6.apps.googleusercontent.com';
  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://physiocareapp.runasp.net';

  const getCookie = (name) => {
    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  };

  const isAuthenticated = useCallback(() => {
    if (user && user.exp && user.exp > Date.now()) {
      return { isAuth: true, user, source: 'context' };
    }

    const accessToken = localStorage.getItem('accessToken');
    const savedUser = localStorage.getItem('user');
    
    if (accessToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        if (parsedUser.exp && parsedUser.exp > Date.now()) {
          return { isAuth: true, user: parsedUser, source: 'localStorage' };
        }
      } catch (error) {
        console.error('Error parsing saved user:', error);
      }
    }

    const cookieToken = getCookie('accessToken');
    const cookieRole = getCookie('userRole');
    
    if (cookieToken && cookieRole) {
      return { 
        isAuth: true, 
        user: { role: cookieRole, email: getCookie('userEmail') || 'unknown@example.com' }, 
        source: 'cookies' 
      };
    }

    return { isAuth: false, user: null, source: null };
  }, [user]);

  const navigateByRole = useCallback((userRole, source = 'login') => {
    const roleRoutes = {
      SuperAdmin: '/admin',
      Admin: '/admin',
      Doctor: '/DashboardDoctorOfficial',
      Nurse: '/dashboard-nurse',
      Laboratory: '/DashBoardLaboratoryOfficial',
      Patient: '/homepage',
    };
    
    const route = roleRoutes[userRole] || '/homepage';
    console.log(`🔄 Navigating user with role "${userRole}" to: ${route} (source: ${source})`);
    
    const intendedRoute = location.state?.from?.pathname;
    const finalRoute = intendedRoute && intendedRoute !== '/login' ? intendedRoute : route;
    
    navigate(finalRoute, { replace: true });
  }, [navigate, location.state]);

  useEffect(() => {
    const checkAuthentication = () => {
      setIsCheckingAuth(true);
      const authStatus = isAuthenticated();
      if (authStatus.isAuth) {
        console.log(`✅ User already authenticated (${authStatus.source}):`, authStatus.user);
        navigateByRole(authStatus.user.role || authStatus.user.Role, 'redirect');
      } else {
        console.log('🔓 User not authenticated, showing login form');
        setIsCheckingAuth(false);
      }
    };
    checkAuthentication();
  }, [isAuthenticated, navigateByRole]);

  const handleCredentialResponse = useCallback(
    async (response) => {
      console.log('Google ID Token received');
      setGoogleLoading(true);
      setGoogleError('');

      try {
        const idToken = response.credential;
        const endpoint = `${API_BASE_URL}/api/ExternalGoogle/AuthGoogleLogin?idToken=${encodeURIComponent(idToken)}`;

        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          mode: 'cors',
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error('Server response:', errorText);
          if (res.status === 500 && errorText.includes('NULL')) {
            setGoogleError('Google sign-in requires additional profile information. Redirecting to registration...');
            setTimeout(() => navigate('/register?source=google&error=incomplete_profile'), 3000);
            return;
          }
          throw new Error(`Google authentication failed: ${errorText}`);
        }

        const data = await res.json();
        console.log('Google login response:', data);

        const accessToken = data.accessToken || data.token;
        const user = data.user || { email: data.email || 'google-user@example.com', id: data.userId || null };

        if (!accessToken) {
          throw new Error('No authentication token received');
        }

        const loginResult = await login(accessToken, user);
        navigateByRole(loginResult.role, 'google-login');
      } catch (error) {
        console.error('Google login error:', error);
        setGoogleError(error.message || 'Google authentication failed. Please try again.');
      } finally {
        setGoogleLoading(false);
      }
    },
    [navigate, API_BASE_URL, login]
  );

  const initializeGoogleSignIn = useCallback(() => {
    if (!window.google?.accounts?.id || googleInitialized) return;

    try {
      console.log('Initializing Google Sign-In');
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: 'popup',
      });

      const buttonContainer = document.getElementById('google-signin-button-container');
      if (buttonContainer) {
        buttonContainer.innerHTML = '';
        window.google.accounts.id.renderButton(buttonContainer, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          width: Math.min(buttonContainer.offsetWidth || 300, 300),
          text: 'signin_with',
        });
      }

      setGoogleInitialized(true);
      setGoogleError('');
      console.log('Google Sign-In initialized successfully');
    } catch (error) {
      console.error('Error initializing Google Sign-In:', error);
      setGoogleError('Google authentication is temporarily unavailable. Please try again later.');
    }
  }, [handleCredentialResponse, googleInitialized, GOOGLE_CLIENT_ID]);

  useEffect(() => {
    if (isCheckingAuth) return;

    document.documentElement.lang = 'en';

    const existingScript = document.getElementById('google-signin-script');
    if (existingScript && window.google?.accounts?.id) {
      initializeGoogleSignIn();
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-signin-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setTimeout(initializeGoogleSignIn, 500);
    script.onerror = () => setGoogleError('Could not load Google Sign-In.');
    document.head.appendChild(script);

    return () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.cancel();
      }
    };
  }, [initializeGoogleSignIn, isCheckingAuth]);

  if (isCheckingAuth) {
    return (
      <div className="container-fluid d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <h5 className="text-muted">Checking authentication...</h5>
          <p className="text-muted">Please wait a moment</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid" style={{ minHeight: '100vh', overflowY: 'auto' }}>
      <div className="row" style={{ minHeight: '100vh' }}>
        <div className="col-md-6 d-none d-md-block p-0">
          <div
            style={{
              width: '100%',
              height: '100vh',
              position: 'sticky',
              top: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={bg}
              alt="Login Background"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        </div>
        <div
          className="col-md-6 d-flex align-items-center justify-content-center bg-light"
          style={{ minHeight: '100vh', padding: '2rem 0' }}
        >
          <div className="w-100 px-4" style={{ maxWidth: '500px' }}>
            <div
              className="card shadow p-4"
              style={{
                backgroundColor: 'rgba(245, 252, 255, 0.98)',
                border: '2px solid #0d6efd',
                borderRadius: '15px',
                transition: 'all 0.3s ease',
              }}
            >
              <h3
                className="text-center mb-4"
                style={{
                  color: '#0d6efd',
                  fontWeight: '700',
                  fontSize: '1.65rem',
                  background: 'linear-gradient(135deg, #0d6efd 0%, #0056b3 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  letterSpacing: '-0.5px',
                }}
              >
                Welcome to PhysioCare
              </h3>
              
              <p className="text-center text-muted mb-4" style={{ fontSize: '1rem' }}>
                Sign in with your Google account to continue
              </p>
              
              {location.state?.from && (
                <div className="alert alert-info mb-3" role="alert">
                  <div className="d-flex align-items-center">
                    <svg
                      width="16"
                      height="16"
                      className="me-2"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4" />
                      <path d="M12 8h.01" />
                    </svg>
                    Please sign in to access {location.state.from.pathname}
                  </div>
                </div>
              )}

              {googleError && (
                <div
                  className="alert alert-warning mb-4"
                  role="alert"
                  style={{
                    borderRadius: '8px',
                    border: '1px solid #f1c40f',
                    backgroundColor: 'rgba(241, 196, 15, 0.1)',
                  }}
                >
                  <div className="d-flex align-items-center">
                    <svg
                      width="16"
                      height="16"
                      className="me-2"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L12.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <circle cx="12" cy="17" r="1" />
                    </svg>
                    {googleError}
                  </div>
                </div>
              )}

              <div className="d-flex justify-content-center">
                <div
                  id="google-signin-button-container"
                  style={{ width: '100%', maxWidth: '300px' }}
                >
                  {googleLoading && (
                    <div className="text-center">
                      <div className="spinner-border text-primary" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                      <p className="mt-2 text-muted">Authenticating with Google...</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-center mt-4">
                <p className="mb-0" style={{ color: '#6c757d', fontSize: '0.9rem' }}>
                  Need help?{' '}
                  <a
                    href="/support"
                    className="text-decoration-none fw-semibold"
                    style={{ color: '#0d6efd' }}
                  >
                    Contact Support
                  </a>
                </p>
              </div>
            </div>
            <div className="text-center mt-4">
              <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                By signing in, you agree to our{' '}
                <a href="/terms" className="text-decoration-none" style={{ color: '#0d6efd' }}>
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" className="text-decoration-none" style={{ color: '#0d6efd' }}>
                  Privacy Policy
                </a>
              </p>
              <div className="mt-3">
                <small className="text-muted">© 2025 PhysioCare. All rights reserved.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
      {googleLoading && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 9999, backdropFilter: 'blur(2px)' }}
        >
          <div className="text-center text-white">
            <div
              className="spinner-border mb-3"
              role="status"
              style={{ width: '3rem', height: '3rem' }}
            >
              <span className="visually-hidden">Loading...</span>
            </div>
            <h5>Authenticating with Google...</h5>
            <p className="text-light">Please wait a moment</p>
          </div>
        </div>
      )}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {googleLoading && 'Google authentication in progress'}
        {googleError && `Google authentication error: ${googleError}`}
      </div>
      <style>{`
        .btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(13, 110, 253, 0.3);
        }
        .card {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
          transform: translateY(-5px);
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15) !important;
        }
        @media (max-width: 768px) {
          .col-md-6 {
            padding: 1rem !important;
          }
          .card {
            margin: 0 !important;
            border-radius: 10px !important;
            border-width: 1px !important;
          }
        }
        #google-signin-button-container > div {
          width: 100% !important;
          display: flex !important;
          justify-content: center !important;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .card {
          animation: fadeIn 0.6s ease-out;
        }
        .alert {
          font-size: 0.85rem;
          padding: 0.75rem;
        }
        .spinner-border {
          border-width: 0.2em;
        }
      `}</style>
    </div>
  );
};

export default LoginPage;