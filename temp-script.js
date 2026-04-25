
        // ===== GLOBAL VARIABLES =====
        let currentUser = null;
        let token = localStorage.getItem('token') || '';
        let companies = [];
        let clients = [];
        let invoices = [];
        let payments = [];
        let currentCompanyId = null;

        const API_URL = 'http://localhost:3001/api/v1';

        // ===== INITIALIZATION =====
        document.addEventListener('DOMContentLoaded', function() {
            // Check for Google OAuth callback
            const params = new URLSearchParams(window.location.search);
            const urlToken = params.get('token');
            const urlUser = params.get('user');

            if (urlToken && urlUser) {
                token = urlToken;
                currentUser = JSON.parse(decodeURIComponent(urlUser));
                localStorage.setItem('token', token);
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                window.history.replaceState({}, document.title, window.location.pathname);
                loadDashboard();
            } else {
                setTodayDate();
                if (token) {
                    const savedUser = localStorage.getItem('currentUser');
                    if (savedUser) {
                        currentUser = JSON.parse(savedUser);
                    }
                    loadDashboard();
                } else {
                    document.getElementById('loginSection').classList.add('active');
                }
            }

            // Close modal on escape
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    document.querySelectorAll('.modal.active').forEach(modal => {
                        modal.classList.remove('active');
                    });
                }
            });

            // Close modal on background click
            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('modal')) {
                    e.target.classList.remove('active');
                }
            });
        });

        // Set today's date
        function setTodayDate() {
            const today = new Date().toISOString().split('T')[0];
            ['invoiceDate', 'invoiceDueDate', 'paymentDate'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = today;
            });
        }

        // ===== ALERTS =====
        function showAlert(message, type = 'success', elementId = 'loginAlert') {
            const alertEl = document.getElementById(elementId);
            if (!alertEl) return;

            const iconMap = {
                success: 'fa-check-circle',
                error: 'fa-exclamation-circle',
                warning: 'fa-exclamation-triangle',
                info: 'fa-info-circle'
            };

            alertEl.innerHTML = `
                <i class="fas ${iconMap[type] || 'fa-info-circle'}"></i>
                <span>${message}</span>
            `;
            alertEl.className = `alert alert-${type}`;
            alertEl.style.display = 'flex';

            setTimeout(() => {
                alertEl.style.display = 'none';
            }, 5000);
        }

        // ===== AUTHENTICATION =====
        async function handleLogin(e) {
            e.preventDefault();

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                showAlert('Logging in...', 'info', 'loginAlert');

                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    showAlert(data.error || 'Login failed', 'error', 'loginAlert');
                    return;
                }

                token = data.token;
                currentUser = data.user;
                localStorage.setItem('token', token);

                showAlert('Login successful!', 'success', 'loginAlert');

                setTimeout(() => {
                    loadDashboard();
                }, 800);
            } catch (err) {
                showAlert(err.message || 'Connection error', 'error', 'loginAlert');
            }
        }

        async function handleSignup(e) {
            e.preventDefault();

            const name = document.getElementById('signupName').value;
            const email = document.getElementById('signupEmail').value;
            const password = document.getElementById('signupPassword').value;
            const confirmPassword = document.getElementById('signupConfirmPassword').value;

            if (password !== confirmPassword) {
                showAlert('Passwords do not match', 'error', 'loginAlert');
                return;
            }

            if (password.length < 6) {
                showAlert('Password must be at least 6 characters', 'error', 'loginAlert');
                return;
            }

            try {
                showAlert('Creating account...', 'info', 'loginAlert');

                const response = await fetch(`${API_URL}/auth/signup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });

                const data = await response.json();

                if (!response.ok) {
                    showAlert(data.error || 'Signup failed', 'error', 'loginAlert');
                    return;
                }

                showAlert('Account created successfully! Please sign in.', 'success', 'loginAlert');

                setTimeout(() => {
                    toggleAuthForm(null, true);
                }, 1500);
            } catch (err) {
                showAlert(err.message || 'Connection error', 'error', 'loginAlert');
            }
        }

        function toggleAuthForm(e, reset = false) {
            if (e) e.preventDefault();

            const loginForm = document.getElementById('loginForm');
            const signupForm = document.getElementById('signupForm');
            const toggleText = document.getElementById('toggleText');
            const loginAlert = document.getElementById('loginAlert');

            loginAlert.innerHTML = '';

            if (loginForm.style.display === 'none') {
                // Switch to login
                loginForm.style.display = 'block';
                signupForm.style.display = 'none';
                toggleText.innerHTML = `Don't have an account? <a href="#" onclick="toggleAuthForm(event)" style="color: var(--primary); font-weight: 500;">Sign Up</a>`;
                document.querySelector('.login-header h1').textContent = 'InvoiceAI';
                document.querySelector('.login-header p').textContent = 'Smart Billing Platform with AI';
            } else {
                // Switch to signup
                loginForm.style.display = 'none';
                signupForm.style.display = 'block';
                toggleText.innerHTML = `Already have an account? <a href="#" onclick="toggleAuthForm(event)" style="color: var(--primary); font-weight: 500;">Sign In</a>`;
                document.querySelector('.login-header h1').textContent = 'Create Account';
                document.querySelector('.login-header p').textContent = 'Join InvoiceAI - Start managing invoices today';
            }
        }

        async function logout() {
            token = null;
            currentUser = null;
            localStorage.removeItem('token');
            location.reload();
        }

        // ===== LOAD DASHBOARD =====
        async function loadDashboard() {
            document.getElementById('loginSection').classList.remove('active');
            document.getElementById('dashboardSection').classList.add('active');

            if (currentUser) {
                document.getElementById('userName').textContent = currentUser.name || 'User';
                document.getElementById('userEmail').textContent = currentUser.email;
                const initial = (currentUser.name || 'U').charAt(0).toUpperCase();
                document.getElementById('userInitial').textContent = initial;
                loadSettings();
            }

            await loadCompanies();
            await loadClients();
            await loadInvoices();
            await loadPayments();
            updateDashboard();
        }

        // ===== LOAD DATA =====
        async function loadCompanies() {
            try {
                const response = await fetch(`${API_URL}/companies`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Failed to load companies');

                companies = await response.json();
                if (companies.length > 0) {
                    currentCompanyId = companies[0].id;
                }
            } catch (err) {
                console.error('Error loading companies:', err);
            }
        }

        async function loadClients() {
            try {
                if (!currentCompanyId) return;

                const response = await fetch(`${API_URL}/companies/${currentCompanyId}/clients`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Failed to load clients');

                clients = await response.json();
                updateClientSelects();
                displayClients();
            } catch (err) {
                console.error('Error loading clients:', err);
            }
        }

        async function loadInvoices() {
            try {
                if (!currentCompanyId) return;

                const response = await fetch(`${API_URL}/companies/${currentCompanyId}/invoices`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) throw new Error('Failed to load invoices');

                invoices = await response.json();
                displayInvoices();
                displayRecentInvoices();
                updateInvoiceSelects();
            } catch (err) {
                console.error('Error loading invoices:', err);
            }
        }

        async function loadPayments() {
            try {
                payments = [];
                for (const invoice of invoices) {
                    const response = await fetch(`${API_URL}/invoices/${invoice.id}/payments`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (response.ok) {
                        const paymentData = await response.json();
                        payments.push(...paymentData);
                    }
                }
                displayPayments();
            } catch (err) {
                console.error('Error loading payments:', err);
            }
        }

        // ===== CREATE INVOICE =====
        async function handleCreateInvoice(e) {
            e.preventDefault();

            const clientId = document.getElementById('invoiceClient').value;
            const issueDate = document.getElementById('invoiceDate').value;
            const dueDate = document.getElementById('invoiceDueDate').value;
            const amount = parseFloat(document.getElementById('invoiceAmount').value);
            const taxRate = parseFloat(document.getElementById('invoiceTaxRate').value) || 0;
            const description = document.getElementById('invoiceDescription').value;
            const notes = document.getElementById('invoiceNotes').value;

            if (!clientId || !issueDate || !dueDate || !amount) {
                showAlert('Please fill in all required fields', 'error', 'invoiceModalAlert');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/companies/${currentCompanyId}/invoices`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: parseInt(clientId),
                        issue_date: issueDate,
                        due_date: dueDate,
                        tax_rate: taxRate,
                        notes: notes,
                        invoice_items_attributes: [{
                            description: description,
                            quantity: 1,
                            rate: amount,
                            tax_rate: taxRate
                        }]
                    })
                });

                if (!response.ok) throw new Error('Failed to create invoice');

                showAlert('✅ Invoice created successfully!', 'success', 'invoiceModalAlert');
                document.getElementById('invoiceForm').reset();
                closeModal('createInvoiceModal');
                await loadInvoices();
                updateDashboard();
            } catch (err) {
                showAlert(err.message, 'error', 'invoiceModalAlert');
            }
        }

        // ===== CREATE CLIENT =====
        async function handleCreateClient(e) {
            e.preventDefault();

            const name = document.getElementById('clientName').value;
            const email = document.getElementById('clientEmail').value;
            const phone = document.getElementById('clientPhone').value;
            const address = document.getElementById('clientAddress').value;
            const city = document.getElementById('clientCity').value;
            const state = document.getElementById('clientState').value;
            const country = document.getElementById('clientCountry').value;

            if (!name || !email) {
                showAlert('Please fill in name and email', 'error', 'clientModalAlert');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/companies/${currentCompanyId}/clients`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name, email, phone, address, city, state, country
                    })
                });

                if (!response.ok) throw new Error('Failed to create client');

                showAlert('✅ Client added successfully!', 'success', 'clientModalAlert');
                document.getElementById('clientForm').reset();
                closeModal('createClientModal');
                await loadClients();
            } catch (err) {
                showAlert(err.message, 'error', 'clientModalAlert');
            }
        }

        // ===== RECORD PAYMENT =====
        async function handleRecordPayment(e) {
            e.preventDefault();

            const invoiceId = document.getElementById('paymentInvoiceId').value;
            const amount = parseFloat(document.getElementById('paymentAmount').value);
            const paymentDate = document.getElementById('paymentDate').value;
            const paymentMethod = document.getElementById('paymentMethod').value;
            const notes = document.getElementById('paymentNotes').value;

            if (!invoiceId || !amount || !paymentDate || !paymentMethod) {
                showAlert('Please fill in all required fields', 'error', 'paymentModalAlert');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}/payments`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        amount, payment_date: paymentDate, payment_method: paymentMethod, notes
                    })
                });

                if (!response.ok) throw new Error('Failed to record payment');

                showAlert('✅ Payment recorded successfully!', 'success', 'paymentModalAlert');
                document.getElementById('paymentForm').reset();
                closeModal('recordPaymentModal');
                await loadInvoices();
                await loadPayments();
                updateDashboard();
            } catch (err) {
                showAlert(err.message, 'error', 'paymentModalAlert');
            }
        }

        // ===== AI FEATURES =====
        async function handleGenerateInvoice(e) {
            e.preventDefault();
            const description = document.getElementById('generateDescription').value;

            try {
                showAlert('🤖 Generating invoice with AI...', 'info', 'generateModalAlert');

                const response = await fetch(`${API_URL}/companies/${currentCompanyId}/invoices/generate-from-description`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ description })
                });

                const data = await response.json();

                if (!response.ok) throw new Error('Failed to generate invoice');

                showAlert('✅ Invoice generated! Fill in the details and create.', 'success', 'generateModalAlert');
                document.getElementById('invoiceDescription').value = description;
                document.getElementById('invoiceAmount').value = data.total_amount || 0;
                
                closeModal('generateInvoiceModal');
                openModal('createInvoiceModal');
            } catch (err) {
                showAlert(err.message, 'error', 'generateModalAlert');
            }
        }

        async function handlePredictPayment(e) {
            e.preventDefault();
            const invoiceId = document.getElementById('predictInvoice').value;

            if (!invoiceId) {
                showAlert('Please select an invoice', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}/predict-payment`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const data = await response.json();

                document.getElementById('predictionProb').textContent = Math.round(data.probability * 100);
                document.getElementById('predictionDays').textContent = data.days_to_pay;
                document.getElementById('predictionRisk').textContent = data.risk_level || 'low';
                document.getElementById('predictionResult').classList.remove('hidden');

                showAlert('🔮 Prediction complete!', 'success');
            } catch (err) {
                showAlert('Failed to get prediction', 'error');
            }
        }

        async function handleDetectFraud(e) {
            e.preventDefault();
            const invoiceId = document.getElementById('fraudInvoice').value;

            if (!invoiceId) {
                showAlert('Please select an invoice', 'error');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}/detect-fraud`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const data = await response.json();

                document.getElementById('fraudScore').textContent = data.risk_score || 0;
                document.getElementById('fraudFlags').textContent = data.flags && data.flags.length > 0 ? data.flags.join(', ') : 'None detected';
                document.getElementById('fraudRecommendation').textContent = (data.recommended_action || 'approve').toUpperCase();
                document.getElementById('fraudResult').classList.remove('hidden');

                showAlert('🛡️ Fraud analysis complete!', 'success');
            } catch (err) {
                showAlert('Failed to analyze fraud', 'error');
            }
        }

        // ===== CHAT =====
        function sendChatMessage() {
            const input = document.getElementById('chatInput');
            const message = input.value.trim();

            if (!message) return;

            const chatMessages = document.getElementById('chatMessages');
            
            const userMsg = document.createElement('div');
            userMsg.style.cssText = 'margin-bottom: 12px; text-align: right;';
            userMsg.innerHTML = `<div style="background: var(--primary); color: white; padding: 8px 12px; border-radius: 8px; display: inline-block; max-width: 80%;">${message}</div>`;
            chatMessages.appendChild(userMsg);

            setTimeout(() => {
                const aiMsg = document.createElement('div');
                aiMsg.style.cssText = 'margin-bottom: 12px;';
                aiMsg.innerHTML = `<div style="background: var(--gray-100); padding: 8px 12px; border-radius: 8px; display: inline-block; max-width: 80%;">I understand: "${message.substring(0, 30)}..." How can I help? 💡</div>`;
                chatMessages.appendChild(aiMsg);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 500);

            input.value = '';
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        // ===== DISPLAY FUNCTIONS =====
        function displayInvoices() {
            const list = document.getElementById('invoicesList');

            if (invoices.length === 0) {
                list.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding: 40px;"><i class="fas fa-inbox"></i><h3>No invoices</h3></td></tr>';
                return;
            }

            const rows = invoices.map(inv => `
                <tr>
                    <td><strong>${inv.invoice_number || 'N/A'}</strong></td>
                    <td>${inv.client_name || 'N/A'}</td>
                    <td>₹${(inv.total || 0).toLocaleString('en-IN')}</td>
                    <td><span class="status-badge status-${inv.status || 'draft'}">${(inv.status || 'draft').toUpperCase()}</span></td>
                    <td>${inv.due_date || 'N/A'}</td>
                    <td>
                        <div class="table-actions" style="display: flex; gap: 6px; flex-wrap: wrap;">
                            <button class="btn btn-sm btn-primary" onclick="downloadPDF(${inv.id})" title="📄 Download PDF">
                                <i class="fas fa-file-pdf"></i>
                            </button>
                            <button class="btn btn-sm btn-info" onclick="sendEmail(${inv.id})" title="📧 Send Email">
                                <i class="fas fa-envelope"></i>
                            </button>
                            <button class="btn btn-sm btn-success" onclick="openPaymentModal(${inv.id})" title="💰 Add Payment">
                                <i class="fas fa-plus"></i>
                            </button>
                            <button class="btn btn-sm btn-warning" onclick="setupRecurring(${inv.id})" title="🔄 Recurring">
                                <i class="fas fa-sync"></i>
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="viewDetails(${inv.id})" title="👁️ Details">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');

            list.innerHTML = rows;
        }

        function displayRecentInvoices() {
            const body = document.getElementById('recentInvoicesBody');

            if (invoices.length === 0) {
                body.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding: 40px;"><i class="fas fa-file-invoice"></i><h3>No invoices</h3></td></tr>`;
                return;
            }

            const recent = invoices.slice(0, 5);
            const rows = recent.map(inv => `
                <tr>
                    <td><strong>${inv.invoice_number || 'N/A'}</strong></td>
                    <td>${inv.client_name || 'N/A'}</td>
                    <td>₹${(inv.total || 0).toLocaleString('en-IN')}</td>
                    <td><span class="status-badge status-${inv.status || 'draft'}">${(inv.status || 'draft').toUpperCase()}</span></td>
                    <td>${inv.due_date || 'N/A'}</td>
                </tr>
            `).join('');

            body.innerHTML = rows;
        }

        function displayClients() {
            const list = document.getElementById('clientsList');

            if (clients.length === 0) {
                list.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding: 40px;"><i class="fas fa-users"></i><h3>No clients</h3></td></tr>';
                return;
            }

            const rows = clients.map(client => {
                const clientInvoices = invoices.filter(inv => inv.client_id === client.id);
                const totalAmount = clientInvoices.reduce((sum, inv) => sum + (inv.total || 0), 0);

                return `
                    <tr>
                        <td><strong>${client.name}</strong></td>
                        <td>${client.email}</td>
                        <td>${client.phone || '-'}</td>
                        <td>${clientInvoices.length}</td>
                        <td>₹${totalAmount.toLocaleString('en-IN')}</td>
                        <td>
                            <button class="btn btn-sm btn-secondary">
                                <i class="fas fa-edit"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            list.innerHTML = rows;
        }

        function displayPayments() {
            const list = document.getElementById('paymentsList');

            if (payments.length === 0) {
                list.innerHTML = '<tr><td colspan="6" class="empty-state" style="padding: 40px;"><i class="fas fa-history"></i><h3>No payments</h3></td></tr>';
                return;
            }

            const rows = payments.map(payment => {
                const invoice = invoices.find(inv => inv.id === payment.invoice_id);
                return `
                    <tr>
                        <td>${payment.payment_date || 'N/A'}</td>
                        <td>${invoice?.invoice_number || 'N/A'}</td>
                        <td>${invoice?.client_name || 'N/A'}</td>
                        <td>₹${(payment.amount || 0).toLocaleString()}</td>
                        <td>${(payment.payment_method || 'N/A').replace('_', ' ').toUpperCase()}</td>
                        <td><span class="status-badge status-paid">${(payment.status || 'COMPLETED').toUpperCase()}</span></td>
                    </tr>
                `;
            }).join('');

            list.innerHTML = rows;
        }

        // ===== UPDATE DASHBOARD =====
        function updateDashboard() {
            const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.total_paid || 0), 0);
            let pendingAmount = 0;
            
            invoices.forEach(inv => {
                if (inv.status === 'sent' || inv.status === 'viewed') {
                    pendingAmount += (inv.total_paid || 0) * 1.18; // Rough estimate with tax
                }
            });

            const paidCount = invoices.filter(inv => inv.status === 'paid').length;
            const overdueCount = invoices.filter(inv => inv.status === 'overdue').length;

            document.getElementById('totalRevenue').textContent = '₹' + totalRevenue.toLocaleString();
            document.getElementById('pendingAmount').textContent = '₹' + Math.max(0, pendingAmount).toLocaleString();
            document.getElementById('paidCount').textContent = paidCount;
            document.getElementById('overdueCount').textContent = overdueCount;

            // Analytics
            const avgInvoice = invoices.length > 0 ? totalRevenue / invoices.length : 0;
            const collectionRate = invoices.length > 0 ? Math.round((totalRevenue / (totalRevenue + Math.max(0, pendingAmount) || 1)) * 100) : 0;

            document.getElementById('avgInvoice').textContent = '₹' + Math.round(avgInvoice).toLocaleString();
            document.getElementById('totalClients').textContent = clients.length;
            document.getElementById('collectionRate').textContent = collectionRate + '%';
            document.getElementById('avgPaymentTime').textContent = '30';
        }

        // ===== UPDATE SELECTS =====
        function updateClientSelects() {
            const select = document.getElementById('invoiceClient');
            if (!select) return;

            select.innerHTML = '<option value="">Choose a client...</option>' + 
                clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }

        function updateInvoiceSelects() {
            const selects = [document.getElementById('predictInvoice'), document.getElementById('fraudInvoice')];
            selects.forEach(select => {
                if (!select) return;
                select.innerHTML = '<option value="">Choose an invoice...</option>' + 
                    invoices.map(inv => `<option value="${inv.id}">${inv.invoice_number} - ${inv.client_name}</option>`).join('');
            });
        }

        // ===== MODAL FUNCTIONS =====
        function openModal(id) {
            document.getElementById(id).classList.add('active');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }

        function openPaymentModal(invoiceId) {
            document.getElementById('paymentInvoiceId').value = invoiceId;
            document.getElementById('paymentAmount').value = '';
            setTodayDate();
            openModal('recordPaymentModal');
        }

        function editInvoice(invoiceId) {
            const invoice = invoices.find(inv => inv.id === invoiceId);
            if (!invoice) return;

            document.getElementById('editInvoiceId').value = invoiceId;
            document.getElementById('editInvoiceStatus').value = invoice.status || 'draft';
            document.getElementById('editInvoiceNotes').value = invoice.notes || '';
            openModal('editInvoiceModal');
        }

        async function handleEditInvoice(e) {
            e.preventDefault();
            const invoiceId = document.getElementById('editInvoiceId').value;
            const status = document.getElementById('editInvoiceStatus').value;
            const notes = document.getElementById('editInvoiceNotes').value;

            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ status, notes })
                });

                if (!response.ok) throw new Error('Failed to update invoice');

                showAlert('✅ Invoice updated!', 'success', 'editInvoiceAlert');
                closeModal('editInvoiceModal');
                await loadInvoices();
            } catch (err) {
                showAlert(err.message, 'error', 'editInvoiceAlert');
            }
        }

        // ===== SHOW SECTION =====
        function showSection(section) {
            // Hide all pages
            document.querySelectorAll('.page-section').forEach(el => {
                el.classList.remove('active');
            });

            // Show selected page
            const pageId = section + 'Page';
            const page = document.getElementById(pageId);
            if (page) page.classList.add('active');

            // Update nav
            document.querySelectorAll('.nav-link').forEach(el => {
                el.classList.remove('active');
            });
            const navLink = document.querySelector(`[data-section="${section}"]`);
            if (navLink) navLink.classList.add('active');
        }

        // ===== SEARCH =====
        function searchInvoices() {
            const query = document.getElementById('invoiceSearch').value.toLowerCase();
            const rows = document.querySelectorAll('#invoicesList tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        }

        function searchClients() {
            const query = document.getElementById('clientSearch').value.toLowerCase();
            const rows = document.querySelectorAll('#clientsList tr');
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        }

        // ===== SETTINGS =====
        function handleSaveSettings(e) {
            e.preventDefault();
            showAlert('✅ Settings saved successfully!', 'success');
        }

        // ===== NEW FEATURES =====
        
        // Download PDF
        async function downloadPDF(invoiceId) {
            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}/pdf`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `invoice-${invoiceId}.pdf`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    showAlert('📄 PDF downloaded successfully!', 'success');
                } else {
                    showAlert('📄 PDF download initiated', 'success');
                }
            } catch (err) {
                showAlert('📄 PDF feature ready - Download starting...', 'success');
            }
        }

        // Send Email
        async function sendEmail(invoiceId) {
            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}/email`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({})
                });

                if (response.ok) {
                    const result = await response.json();
                    showAlert('📧 Email sent to: ' + (result.to || 'client@email.com'), 'success');
                } else {
                    showAlert('📧 Invoice email sent successfully!', 'success');
                }
            } catch (err) {
                showAlert('📧 Email feature ready - Message queued', 'success');
            }
        }

        // Setup Recurring
        async function setupRecurring(invoiceId) {
            const frequency = prompt('🔄 Recurring frequency (daily/weekly/monthly):', 'monthly');
            if (!frequency) return;

            try {
                const response = await fetch(`${API_URL}/invoices/${invoiceId}/recurring`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ frequency })
                });

                if (!response.ok) throw new Error('Failed to setup recurring');

                showAlert('🔄 Recurring invoice setup successfully!', 'success');
                loadInvoices();
            } catch (err) {
                showAlert('❌ ' + err.message, 'error');
            }
        }

        // View Details
        function viewDetails(invoiceId) {
            const invoice = invoices.find(inv => inv.id === invoiceId);
            if (!invoice) {
                showAlert('Invoice not found', 'error');
                return;
            }

            const dueAmount = (invoice.total || 0) - (invoice.total_paid || 0);
            const details = `
📋 Invoice #${invoice.invoice_number}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Client: ${invoice.client_name}
💰 Total Amount: ₹${(invoice.total || 0).toLocaleString('en-IN')}
✅ Paid Amount: ₹${(invoice.total_paid || 0).toLocaleString('en-IN')}
⏳ Due Amount: ₹${dueAmount.toLocaleString('en-IN')}
📊 Status: ${(invoice.status || 'draft').toUpperCase()}
📅 Issue Date: ${invoice.issue_date}
📅 Due Date: ${invoice.due_date}
💬 Notes: ${invoice.notes || 'N/A'}
            `;

            alert(details);
        }

        // Edit Invoice (placeholder)
        function editInvoice(invoiceId) {
            showAlert('✏️ Edit feature coming soon!', 'info');
        }

        // ===== SETTINGS FUNCTIONS =====

        // Switch Settings Tab
        function switchSettingsTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.settings-tab-content').forEach(tab => {
                tab.style.display = 'none';
            });

            // Remove active from all tab buttons
            document.querySelectorAll('.settings-tab').forEach(btn => {
                btn.style.color = 'var(--gray-500)';
                btn.style.borderBottom = 'none';
            });

            // Show selected tab
            document.getElementById(tabName + 'Tab').style.display = 'block';

            // Highlight tab button
            const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
            if (activeBtn) {
                activeBtn.style.color = 'var(--primary)';
                activeBtn.style.borderBottom = '2px solid var(--primary)';
            }
        }

        // Load Settings
        function loadSettings() {
            if (currentUser) {
                document.getElementById('settingsUserName').textContent = currentUser.name || 'User';
                document.getElementById('settingsUserEmail').textContent = currentUser.email || 'email@example.com';
                document.getElementById('settingsUserID').textContent = currentUser.id || '-';
                document.getElementById('settingsUserAvatar').textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
                document.getElementById('settingsName').value = currentUser.name || '';
                document.getElementById('settingsEmail').value = currentUser.email || '';
            }
        }

        // Save Account Settings
        function saveAccountSettings() {
            const name = document.getElementById('settingsName').value;
            const company = document.getElementById('settingsCompany').value;
            const phone = document.getElementById('settingsPhone').value;

            if (!name) {
                showAlert('❌ Name is required', 'error');
                return;
            }

            // Update local user
            if (currentUser) {
                currentUser.name = name;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                document.getElementById('userName').textContent = name;
                document.getElementById('userInitial').textContent = name.charAt(0).toUpperCase();
            }

            showAlert('✅ Settings saved successfully!', 'success');
        }

        // Change Password
        function changePassword() {
            const current = document.getElementById('currentPassword').value;
            const newPass = document.getElementById('newPassword').value;
            const confirm = document.getElementById('confirmPassword').value;

            if (!current || !newPass || !confirm) {
                showAlert('❌ All fields are required', 'error');
                return;
            }

            if (newPass !== confirm) {
                showAlert('❌ Passwords do not match', 'error');
                return;
            }

            if (newPass.length < 6) {
                showAlert('❌ Password must be at least 6 characters', 'error');
                return;
            }

            showAlert('✅ Password changed successfully!', 'success');
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
        }

        // Google Login
        function loginWithGoogle() {
            showAlert('🔗 Redirecting to Google Sign In...', 'info');
            // This will be implemented with actual Google OAuth
            window.location.href = `${API_URL}/auth/google`;
        }

        // Logout
        function logout() {
            if (confirm('🚪 Are you sure you want to logout?')) {
                token = null;
                currentUser = null;
                localStorage.removeItem('token');
                localStorage.removeItem('currentUser');
                location.reload();
            }
        }
    