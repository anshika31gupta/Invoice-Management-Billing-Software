// Test script to verify API endpoints and get token

const API_URL = 'http://localhost:3001/api/v1';

async function testLogin() {
    console.log('🔍 Testing Login...');
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'password123'
            })
        });
        
        const data = await response.json();
        console.log('✅ Login Response:', data);
        
        if (response.ok) {
            console.log('🎯 Token:', data.token);
            return data.token;
        } else {
            console.error('❌ Login failed:', data.error);
            return null;
        }
    } catch (err) {
        console.error('❌ Error:', err.message);
        return null;
    }
}

async function testDashboard(token) {
    if (!token) return;
    
    console.log('\n🔍 Testing Dashboard Endpoints...');
    
    try {
        // Test companies
        let response = await fetch(`${API_URL}/companies`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Companies:', response.ok ? '✅' : '❌', response.status);
        
        // Test auth/profile
        response = await fetch(`${API_URL}/auth/profile`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Auth Profile:', response.ok ? '✅' : '❌', response.status);
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

async function runTests() {
    console.log('🚀 Starting API Tests...\n');
    const token = await testLogin();
    await testDashboard(token);
    console.log('\n✅ Tests Complete!');
}

runTests();
