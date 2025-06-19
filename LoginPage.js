import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../Pages/AuthPage';
import 'bootstrap/dist/css/bootstrap.min.css';
import bg from '../assets/images/mockuuups-iphone-15-pro-mockup-on-a-white-modern-table.jpeg';

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();

  // State management
  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleInitialized, setGoogleInitialized] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Environment variables
  const GOOGLE_CLIENT_ID =
    process.env.REACT_APP_GOOGLE_CLIENT_ID || '318210078663-qfbsl8qbnniu3dqqq2sun50vdu5f5pj6.apps.googleusercontent.com';
  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://physiocareapp.runasp.net';

  // Cookie management
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

  // Check if user is already authenticated
  const isAuthenticated = useCallback(() => {
    // Check context user first
    if (user && user.exp && user.exp > Date.now()) {
      return { isAuth: true, user, source: 'context' };
    }

    // Check localStorage
    const accessToken = localStorage.getItem('accessToken');
    const savedUser = localStorage.getItem('user');
    
    if (accessToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        // Check if token is still valid (not expired)
        if (parsedUser.exp && parsedUser.exp > Date.now()) {
          return { isAuth: true, user: parsedUser, source: 'localStorage' };
        }
      } catch (error) {
        console.error('Error parsing saved user:', error);
      }
    }

    // Check cookies as fallback
    const cookieToken = getCookie('accessToken');
    const cookieRole = getCookie('userRole');
    
    if (cookieToken && cookieRole) {
      return { 
        isAuth: true, 
        user: { 
          role: cookieRole, 
          email: getCookie('userEmail') || 'unknown@example.com' 
        }, 
        source: 'cookies' 
      };
    }

    return { isAuth: false, user: null, source: null };
  }, [user]);

  // Navigation by role
  const navigateByRole = (userRole, source = 'login') => {
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
    
    // Get the intended route from location state
    const intendedRoute = location.state?.from?.pathname;
    const finalRoute = intendedRoute && intendedRoute !== '/login' ? intendedRoute : route;
    
    navigate(finalRoute, { replace: true });
  };

  // Check authentication on mount
  useEffect(() => {
    const checkAuthentication = () => {
      setIsCheckingAuth(true);
      
      const authStatus = isAuthenticated();
      
      if (authStatus.isAuth) {
        console.log(`✅ User already authenticated (${authStatus.source}):`, authStatus.user);
        navigateByRole(authStatus.user.role || authStatus.user.Role, 'redirect');
        return;
      }
      
      console.log('🔓 User not authenticated, showing login form');
      setIsCheckingAuth(false);
    };

    const timer = setTimeout(checkAuthentication, 100);
    return () => clearTimeout(timer);
  }, [isAuthenticated, navigate, location.state]);

  // Google OAuth handler
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
        const refreshToken = data.refreshToken;
        const user = data.user || {
          email: data.email || 'google-user@example.com',
          id: data.userId || null,
        };

        if (!accessToken) {
          throw new Error('No authentication token received');
        }

        const loginResult = await login(accessToken, user);
        navigateByRole(loginResult.role, 'google-login');
      } catch (error) {
        console.error('Google login error:', error);
        setGoogleError(error.message || 'Google authentication failed. Please try email login.');
      } finally {
        setGoogleLoading(false);
      }
    },
    [navigate, API_BASE_URL, login]
  );

  // Initialize Google Sign-In
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
      setGoogleError('Google authentication is temporarily unavailable. Please use email login.');
    }
  }, [handleCredentialResponse, googleInitialized, GOOGLE_CLIENT_ID]);

  // Google Sign-In setup effect
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

  // Form validation
  const validateForm = () => {
    const errors = {};
    const emailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    if (!email.trim()) errors.email = 'Please enter your email address.';
    else if (!emailPattern.test(email)) errors.email = 'Please enter a valid email address.';

    if (!password.trim()) errors.password = 'Please enter your password.';
    else if (password.length < 6) errors.password = 'Password must be at least 6 characters.';

    setErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Regular login handler
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    setErrors({});

    try {
      const formdata = new FormData();
      formdata.append("email", email.trim());
      formdata.append("password", password.trim());

      const response = await fetch("https://physiocareapp.runasp.net/api/v1/Account/login", {
        method: "POST",
        body: formdata,
        credentials: "include",
        mode: "cors"
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', errorText, 'Status:', response.status);
        throw new Error(`Login failed: ${errorText || response.statusText}`);
      }

      const data = await response.json();
      console.log('Login response:', data);

      if (data.accessToken) {
        const accessToken = data.accessToken;
        const user = data.user || { email: email.trim(), id: data.userId };

        const loginResult = await login(accessToken, user);
        navigateByRole(loginResult.role, 'form-login');
      } else if (data.message?.includes('Email not confirmed') || response.status === 403) {
        navigate('/verify-otp', { state: { email: email.trim() } });
      } else {
        setErrors({ form: data.message || 'Login failed. Please check your credentials.' });
      }
    } catch (error) {
      console.error('Login error:', error);
      if (error.message.includes('CORS') || error.name === 'TypeError') {
        setErrors({ form: 'Unable to connect to the server due to CORS restrictions. Please try again later or contact support.' });
      } else {
        setErrors({ form: error.message || 'Network error. Please try again.' });
      }
    } finally {
      setLoading(false);
    }
  };

  // Show loading spinner while checking authentication
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
                Welcome Back to PhysioCare
              </h3>
              
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

              <form onSubmit={handleLogin}>
                {errors.form && (
                  <div className="alert alert-danger" role="alert">
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
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      {errors.form}
                    </div>
                  </div>
                )}
                <div className="mb-3">
                  <label
                    htmlFor="email"
                    className="form-label"
                    style={{ color: '#333', fontSize: '0.9rem', fontWeight: '500' }}
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    className={`form-control ${errors.email ? 'is-invalid' : ''}`}
                    id="email"
                    placeholder="Email Address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      backgroundColor: 'rgba(240, 245, 255, 0.9)',
                      border: '1px solid #0d6efd',
                      borderRadius: '8px',
                      padding: '0.75rem 1rem',
                      fontSize: '0.9rem',
                      transition: 'all 0.2s ease-in-out',
                    }}
                  />
                  {errors.email && <div className="invalid-feedback">{errors.email}</div>}
                </div>
                <div className="mb-4">
                  <label
                    htmlFor="password"
                    className="form-label"
                    style={{ color: '#333', fontSize: '0.9rem', fontWeight: '500' }}
                  >
                    Password
                  </label>
                  <div className="position-relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                      id="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{
                        backgroundColor: 'rgba(240, 245, 255, 0.9)',
                        border: errors.password ? '1px solid #dc3545' : '1px solid #0d6efd',
                        borderRadius: '8px',
                        padding: '0.75rem 3rem 0.75rem 1rem',
                        fontSize: '0.9rem',
                        transition: 'all 0.2s ease-in-out',
                      }}
                    />
                    {password.length > 0 && (
                      <button
                        type="button"
                        className="btn position-absolute top-50 end-0 translate-middle-y me-2 p-1 password-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: showPassword ? '#0d6efd' : '#6c757d',
                          fontSize: '1.2rem',
                          zIndex: 10,
                          transition: 'color 0.2s ease, transform 0.1s ease',
                          padding: '0 10px',
                        }}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="toggle-icon"
                          >
                            <path d="M17.94 17.94A708.07 0 1 12 20c-7 0-11-8-11-8a18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="toggle-icon"
                          >
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    )}
                    {errors.password && (
                      <div
                        className="invalid-feedback d-flex align-items-center"
                        style={{
                          fontSize: '0.85rem',
                          color: '#dc3545',
                          backgroundColor: 'rgba(220, 53, 69, 0.1)',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          marginTop: '0.25rem',
                        }}
                      >
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
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        {errors.password}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-end">
                    <a
                      href="/forgot-password"
                      className="text-decoration-none"
                      style={{
                        color: '#0d6efd',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        transition: 'none',
                      }}
                    >
                      Forgot Password?
                    </a>
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading}
                  style={{
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    fontWeight: '600',
                    backgroundColor: '#0d6efd',
                    borderColor: '#0d6efd',
                    fontSize: '0.95rem',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {loading ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <svg
                        className="ms-2"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14" />
                        <path d="M12 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>
              </form>
              <div className="my-4">
                <div className="d-flex align-items-center mb-3">
                  <hr className="flex-grow-1" style={{ borderColor: '#e9ecef', opacity: 0.5 }} />
                  <span
                    className="px-3"
                    style={{ color: '#6c757d', fontSize: '0.85rem', fontWeight: '500' }}
                  >
                    or continue with
                  </span>
                  <hr className="flex-grow-1" style={{ borderColor: '#e9ecef', opacity: 0.5 }} />
                </div>
                {googleError && (
                  <div
                    className="alert alert-warning mb-3"
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
              </div>
              <div className="text-center">
                <p className="mb-0" style={{ color: '#6c757d', fontSize: '0.9rem' }}>
                  Don't have an account?{' '}
                  <a
                    href="/register"
                    className="text-decoration-none fw-semibold"
                    style={{ color: '#0d6efd' }}
                  >
                    Register
                  </a>
                  {' | '}
                  <a
                    href="/verify-otp"
                    className="text-decoration-none fw-semibold"
                    style={{ color: '#0d6efd' }}
                  >
                    Verify Email
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
      {(loading || googleLoading) && (
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
            <h5>{loading ? 'Signing you in...' : 'Authenticating with Google...'}</h5>
            <p className="text-light">Please wait a moment</p>
          </div>
        </div>
      )}
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {loading && 'Login in progress'}
        {googleLoading && 'Google authentication in progress'}
        {errors.form && `Login error: ${errors.form}`}
        {googleError && `Google authentication error: ${googleError}`}
      </div>
      <style>{`
        .form-control:focus {
          border-color: #0d6efd !important;
          box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.15) !important;
        }
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
          .btn-primary {
            font-size: 0.9rem !important;
            padding: 0.65rem !important;
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
        .password-toggle:hover {
          color: #0d6efd !important;
          transform: scale(1.1);
        }
        .toggle-icon {
          transition: transform 0.2s ease;
        }
        .password-toggle:active .toggle-icon {
          transform: scale(0.9);
        }
        .is-invalid {
          background-image: none !important;
        }
        .invalid-feedback {
          display: flex !important;
          align-items: center;
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
};

export default LoginPage;