import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  AccountStatus,
  Employee,
  PermissionAction,
  PermissionModuleKey,
  RoleDefinition,
  RolePermissionMatrix,
  Sale,
} from '../../types';
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  clonePermissionsMatrix,
  createEmptyPermissionsMatrix,
  getDefaultRoleTemplate,
  isSalesmanOrCashierRole,
  normalizeRoleKey,
} from '../../utils/rbacDefaults';
import { exportToCSV, formatCurrency, formatDate, formatTime } from '../../utils/formatters';
import {
  ShieldCheck,
  Users,
  UserPlus,
  UserCheck,
  UserX,
  Ban,
  PauseCircle,
  Search,
  KeyRound,
  Edit2,
  Eye,
  TrendingUp,
  Award,
  Activity,
  Lock,
  CheckCircle2,
  AlertCircle,
  Download,
  Plus,
  Trash2,
  RotateCcw,
  Save,
  X,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Database,
  Receipt,
  Building2,
  Phone,
  Mail,
  Calendar,
  EyeOff,
} from 'lucide-react';

type ActiveSubTab = 'overview' | 'employees' | 'roles' | 'activity' | 'security';

const STATUS_BADGE_MAP: Record<AccountStatus, { label: string; className: string }> = {
  active: {
    label: 'Active',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  inactive: {
    label: 'Inactive',
    className: 'bg-slate-100 text-slate-600 border-slate-200',
  },
  suspended: {
    label: 'Suspended',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  blocked: {
    label: 'Blocked',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  },
};

function generateNextEmployeeCode(existing: Employee[]): string {
  let maxNum = 0;
  for (const emp of existing) {
    const match = (emp.employeeCode || '').match(/EMP-(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }
  const next = maxNum + 1;
  return `EMP-${String(next).padStart(3, '0')}`;
}

function generateStrongPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export const UserStaffManagementView: React.FC = () => {
  const {
    employees,
    roles,
    sales,
    branches,
    activityLogs,
    settings,
    isAuthenticatedAdmin,
    isAdmin,
    hasPermission,
    createStaffAccount,
    updateStaffAccount,
    changeStaffStatus,
    resetStaffAccountPassword,
    createCustomRole,
    updateRolePermissionsMatrix,
    deleteCustomRole,
    reloadRbacData,
  } = useApp();

  const lang = settings.language;
  const canCreateStaff = hasPermission('user_management', 'create');
  const canEditStaff = hasPermission('user_management', 'edit');
  const canDeleteStaff = hasPermission('user_management', 'delete');
  const canExportLogs = hasPermission('user_management', 'export');
  const canViewSalary = isAuthenticatedAdmin || isAdmin;

  const [subTab, setSubTab] = useState<ActiveSubTab>('overview');
  const [bannerMsg, setBannerMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Employee directory filters
  const [empSearch, setEmpSearch] = useState('');
  const [empRoleFilter, setEmpRoleFilter] = useState<string>('all');
  const [empStatusFilter, setEmpStatusFilter] = useState<string>('all');
  const [empBranchFilter, setEmpBranchFilter] = useState<string>('all');

  // Modals: Add Employee
  const [isAddEmpOpen, setIsAddEmpOpen] = useState(false);
  const [addFullName, setAddFullName] = useState('');
  const [addEmpCode, setAddEmpCode] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [addRoleId, setAddRoleId] = useState('');
  const [addPosition, setAddPosition] = useState('');
  const [addSalary, setAddSalary] = useState<string>('12000');
  const [addJoiningDate, setAddJoiningDate] = useState(new Date().toISOString().slice(0, 10));
  const [addStatus, setAddStatus] = useState<AccountStatus>('active');
  const [addBranchId, setAddBranchId] = useState(branches[0]?.id || '');
  const [isSavingEmp, setIsSavingEmp] = useState(false);
  const [empFormError, setEmpFormError] = useState<string | null>(null);

  // Modal: Edit Employee
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editRoleId, setEditRoleId] = useState('');
  const [editSalary, setEditSalary] = useState<string>('0');
  const [editJoiningDate, setEditJoiningDate] = useState('');
  const [editStatus, setEditStatus] = useState<AccountStatus>('active');
  const [editBranchId, setEditBranchId] = useState('');
  const [isUpdatingEmp, setIsUpdatingEmp] = useState(false);

  // Modal: Reset Password
  const [resetTargetEmp, setResetTargetEmp] = useState<Employee | null>(null);
  const [resetNewPass, setResetNewPass] = useState('');
  const [isResettingPass, setIsResettingPass] = useState(false);
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string } | null>(null);

  // Modal: Employee Sales & Activity Inspector
  const [inspectingEmp, setInspectingEmp] = useState<Employee | null>(null);

  // Roles & Permissions Matrix state
  const [selectedRoleId, setSelectedRoleId] = useState<string>(() => roles[0]?.id || '');
  const activeSelectedRole: RoleDefinition | undefined = useMemo(
    () => roles.find(r => r.id === selectedRoleId) || roles[0],
    [roles, selectedRoleId]
  );
  const [draftMatrix, setDraftMatrix] = useState<RolePermissionMatrix>(() =>
    activeSelectedRole ? clonePermissionsMatrix(activeSelectedRole.permissions) : createEmptyPermissionsMatrix(false)
  );
  const [isSavingMatrix, setIsSavingMatrix] = useState(false);

  // Create Custom Role Modal
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [cloneFromRoleKey, setCloneFromRoleKey] = useState('salesman');
  const [isCreatingRole, setIsCreatingRole] = useState(false);

  // Activity Log filters
  const [actSearch, setActSearch] = useState('');
  const [actEventFilter, setActEventFilter] = useState('all');
  const [actEmpFilter, setActEmpFilter] = useState('all');

  // Sync draftMatrix whenever selected role switches or async roles load
  React.useEffect(() => {
    if (roles.length === 0) return;
    const found = roles.find(r => r.id === selectedRoleId);
    if (!found) {
      setSelectedRoleId(roles[0].id);
      setDraftMatrix(clonePermissionsMatrix(roles[0].permissions));
    }
  }, [roles, selectedRoleId]);

  React.useEffect(() => {
    if (branches.length > 0 && (!addBranchId || !branches.some(b => b.id === addBranchId))) {
      setAddBranchId(branches[0].id);
    }
  }, [branches, addBranchId]);

  const handleSelectRole = (role: RoleDefinition) => {
    setSelectedRoleId(role.id);
    setDraftMatrix(clonePermissionsMatrix(role.permissions));
  };

  // ====================
  // COMPUTED METRICS
  // ====================
  const todayStr = new Date().toISOString().slice(0, 10);

  const employeeStats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter(e => (e.accountStatus || e.status) === 'active').length;
    const inactive = employees.filter(e => (e.accountStatus || e.status) === 'inactive').length;
    const suspended = employees.filter(e => (e.accountStatus || e.status) === 'suspended').length;
    const blocked = employees.filter(e => (e.accountStatus || e.status) === 'blocked').length;
    return {
      total,
      active,
      inactiveCount: inactive + suspended + blocked,
      inactive,
      suspended,
      blocked,
    };
  }, [employees]);

  // Match sales to employees cleanly
  const employeeSalesBreakdown = useMemo(() => {
    const validSales = sales.filter(s => s.status !== 'voided');
    const todaySales = validSales.filter(s => (s.date || '').slice(0, 10) === todayStr);

    interface EmpSaleStat {
      key: string;
      employeeId?: string;
      employeeCode: string;
      employeeName: string;
      roleName: string;
      todayCount: number;
      todayAmount: number;
      todayDiscount: number;
      totalCount: number;
      totalAmount: number;
      paymentMethods: Set<string>;
      lastSaleAt?: string;
    }

    const map = new Map<string, EmpSaleStat>();

    const getOrCreate = (sale: Sale): EmpSaleStat => {
      const matchedEmp = employees.find(
        e =>
          (sale.employeeId && e.id === sale.employeeId) ||
          (sale.employeeId && e.userId === sale.employeeId) ||
          (sale.employeeCode && e.employeeCode === sale.employeeCode) ||
          (sale.sellerId && e.id === sale.sellerId)
      );

      const empCode = matchedEmp?.employeeCode || sale.employeeCode || 'OWNER';
      const empName =
        matchedEmp?.name || sale.employeeName || sale.sellerName || sale.servedBy || 'Store Admin';
      const roleName =
        matchedEmp?.roleName ||
        (matchedEmp?.roleKey ? getDefaultRoleTemplate(matchedEmp.roleKey).name : 'Staff / Admin');
      const mapKey = matchedEmp?.id || sale.employeeId || empCode || empName;

      if (!map.has(mapKey)) {
        map.set(mapKey, {
          key: mapKey,
          employeeId: matchedEmp?.id || sale.employeeId,
          employeeCode: empCode,
          employeeName: empName,
          roleName,
          todayCount: 0,
          todayAmount: 0,
          todayDiscount: 0,
          totalCount: 0,
          totalAmount: 0,
          paymentMethods: new Set<string>(),
        });
      }
      return map.get(mapKey)!;
    };

    // Seed employees so even those with 0 sales appear
    employees.forEach(emp => {
      map.set(emp.id, {
        key: emp.id,
        employeeId: emp.id,
        employeeCode: emp.employeeCode || 'EMP',
        employeeName: emp.name,
        roleName: emp.roleName || getDefaultRoleTemplate(emp.roleKey || emp.role).name,
        todayCount: 0,
        todayAmount: 0,
        todayDiscount: 0,
        totalCount: 0,
        totalAmount: 0,
        paymentMethods: new Set<string>(),
      });
    });

    validSales.forEach(sale => {
      const stat = getOrCreate(sale);
      stat.totalCount += 1;
      stat.totalAmount += Number(sale.total || 0);
      if (!stat.lastSaleAt || sale.date > stat.lastSaleAt) {
        stat.lastSaleAt = sale.date;
      }
      if ((sale.date || '').slice(0, 10) === todayStr) {
        stat.todayCount += 1;
        stat.todayAmount += Number(sale.total || 0);
        stat.todayDiscount += Number(sale.discount || 0);
        if (sale.paymentMethod) stat.paymentMethods.add(sale.paymentMethod);
      }
    });

    const list = Array.from(map.values()).sort((a, b) => {
      if (b.todayAmount !== a.todayAmount) return b.todayAmount - a.todayAmount;
      return b.totalAmount - a.totalAmount;
    });

    const todayTotalAmount = todaySales.reduce((sum, s) => sum + Number(s.total || 0), 0);
    const todayTotalInvoices = todaySales.length;
    const topToday = list.find(l => l.todayAmount > 0) || list[0] || null;
    const topOverall = [...list].sort((a, b) => b.totalAmount - a.totalAmount)[0] || null;

    return {
      list,
      todayTotalAmount,
      todayTotalInvoices,
      topToday,
      topOverall,
      recentStaffSales: validSales.slice(0, 10),
    };
  }, [sales, employees, todayStr]);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return employees.filter(emp => {
      const st = emp.accountStatus || emp.status || 'active';
      const rk = normalizeRoleKey(emp.roleKey || emp.role);
      const matchesQ =
        !q ||
        emp.name.toLowerCase().includes(q) ||
        (emp.employeeCode || '').toLowerCase().includes(q) ||
        (emp.username || '').toLowerCase().includes(q) ||
        (emp.email || '').toLowerCase().includes(q) ||
        (emp.mobile || '').includes(q);
      const matchesRole = empRoleFilter === 'all' || rk === empRoleFilter || emp.roleId === empRoleFilter;
      const matchesStatus = empStatusFilter === 'all' || st === empStatusFilter;
      const matchesBranch = empBranchFilter === 'all' || emp.branchId === empBranchFilter;
      return matchesQ && matchesRole && matchesStatus && matchesBranch;
    });
  }, [employees, empSearch, empRoleFilter, empStatusFilter, empBranchFilter]);

  const filteredActivityLogs = useMemo(() => {
    const q = actSearch.trim().toLowerCase();
    return activityLogs.filter(log => {
      const matchesEvent = actEventFilter === 'all' || log.eventType === actEventFilter;
      const matchesEmp =
        actEmpFilter === 'all' ||
        log.employeeId === actEmpFilter ||
        log.employeeCode === actEmpFilter ||
        log.employeeName === actEmpFilter;
      const matchesQ =
        !q ||
        log.employeeName.toLowerCase().includes(q) ||
        (log.employeeCode || '').toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.moduleKey.toLowerCase().includes(q) ||
        log.eventType.toLowerCase().includes(q);
      return matchesEvent && matchesEmp && matchesQ;
    });
  }, [activityLogs, actSearch, actEventFilter, actEmpFilter]);

  // ====================
  // HANDLERS
  // ====================
  const openAddEmployeeModal = () => {
    const salesmanRole = roles.find(r => r.roleKey === 'salesman') || roles[0];
    setAddFullName('');
    setAddEmpCode(generateNextEmployeeCode(employees));
    setAddPhone('');
    setAddEmail('');
    setAddUsername('');
    setAddPassword(generateStrongPassword());
    setShowAddPassword(true);
    setAddRoleId(salesmanRole?.id || '');
    setAddPosition(salesmanRole?.name || 'Salesman');
    setAddSalary('12000');
    setAddJoiningDate(new Date().toISOString().slice(0, 10));
    setAddStatus('active');
    setAddBranchId(branches[0]?.id || '');
    setEmpFormError(null);
    setIsAddEmpOpen(true);
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpFormError(null);
    if (!canCreateStaff) {
      setEmpFormError('You do not have permission to create staff accounts.');
      return;
    }
    if (!addFullName.trim() || !addPhone.trim() || !addUsername.trim() || !addPassword.trim()) {
      setEmpFormError('Full Name, Phone, Username, and Password are required.');
      return;
    }
    if (addPassword.length < 6) {
      setEmpFormError('Password must be at least 6 characters.');
      return;
    }
    const cleanUser = addUsername.trim().toLowerCase().replace(/\s+/g, '_');
    if (employees.some(emp => (emp.username || '').toLowerCase() === cleanUser)) {
      setEmpFormError(`Username "${cleanUser}" is already assigned to another staff member.`);
      return;
    }
    if (employees.some(emp => (emp.employeeCode || '').toUpperCase() === addEmpCode.trim().toUpperCase())) {
      setEmpFormError(`Employee ID "${addEmpCode.trim()}" already exists.`);
      return;
    }

    const chosenRole = roles.find(r => r.id === addRoleId) || roles[0];
    const chosenBranch = branches.find(b => b.id === addBranchId);

    setIsSavingEmp(true);
    try {
      const created = await createStaffAccount({
        fullName: addFullName.trim(),
        employeeCode: addEmpCode.trim().toUpperCase(),
        phone: addPhone.trim(),
        email: addEmail.trim() || `${cleanUser}@amardokanpro.internal`,
        username: cleanUser,
        password: addPassword,
        roleId: chosenRole?.id || '',
        roleKey: chosenRole?.roleKey || 'salesman',
        roleName: chosenRole?.name || 'Salesman',
        position: addPosition.trim() || chosenRole?.name || 'Staff',
        salary: canViewSalary ? Number(addSalary || 0) : 0,
        joiningDate: addJoiningDate,
        accountStatus: addStatus,
        branchId: chosenBranch?.id || '',
        branchName: chosenBranch?.name || '',
      });

      setBannerMsg({
        type: 'success',
        text: `Staff account created for ${created.name} (${created.employeeCode || cleanUser}) with role ${chosenRole?.name}.`,
      });
      setIsAddEmpOpen(false);
    } catch (err: any) {
      setEmpFormError(err?.message || 'Failed to create staff account.');
    } finally {
      setIsSavingEmp(false);
    }
  };

  const openEditEmployeeModal = (emp: Employee) => {
    const matchedRole =
      roles.find(r => r.id === emp.roleId) ||
      roles.find(r => r.roleKey === normalizeRoleKey(emp.roleKey || emp.role)) ||
      roles[0];
    setEditingEmp(emp);
    setEditName(emp.name);
    setEditCode(emp.employeeCode || '');
    setEditPhone(emp.mobile || '');
    setEditEmail(emp.email || '');
    setEditUsername(emp.username || '');
    setEditPosition(emp.position || '');
    setEditRoleId(matchedRole?.id || '');
    setEditSalary(String(emp.salary || 0));
    setEditJoiningDate(emp.joiningDate || new Date().toISOString().slice(0, 10));
    setEditStatus((emp.accountStatus || emp.status || 'active') as AccountStatus);
    setEditBranchId(emp.branchId || branches[0]?.id || '');
    setEmpFormError(null);
  };

  const handleSaveEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp || !canEditStaff) return;

    const chosenRole = roles.find(r => r.id === editRoleId) || roles[0];
    const chosenBranch = branches.find(b => b.id === editBranchId);

    setIsUpdatingEmp(true);
    try {
      await updateStaffAccount(editingEmp, {
        name: editName.trim(),
        employeeCode: editCode.trim().toUpperCase(),
        mobile: editPhone.trim(),
        email: editEmail.trim() || undefined,
        username: editUsername.trim().toLowerCase() || undefined,
        position: editPosition.trim() || chosenRole?.name,
        roleId: chosenRole?.id,
        roleKey: chosenRole?.roleKey,
        roleName: chosenRole?.name,
        salary: canViewSalary ? Number(editSalary || 0) : editingEmp.salary,
        joiningDate: editJoiningDate,
        accountStatus: editStatus,
        branchId: chosenBranch?.id,
        branchName: chosenBranch?.name,
      });

      setBannerMsg({
        type: 'success',
        text: `Updated staff profile and role for ${editName.trim()}.`,
      });
      setEditingEmp(null);
    } catch (err: any) {
      setEmpFormError(err?.message || 'Failed to update employee.');
    } finally {
      setIsUpdatingEmp(false);
    }
  };

  const handleQuickStatusChange = async (emp: Employee, nextStatus: AccountStatus) => {
    if (!canEditStaff) {
      setBannerMsg({ type: 'error', text: 'You do not have permission to change employee account status.' });
      return;
    }
    try {
      await changeStaffStatus(emp, nextStatus);
      setBannerMsg({
        type: 'success',
        text: `${emp.name}'s account status changed to "${nextStatus.toUpperCase()}".`,
      });
    } catch (err: any) {
      setBannerMsg({ type: 'error', text: err?.message || 'Failed to update status.' });
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetEmp || !canEditStaff) return;
    if (resetNewPass.trim().length < 6) {
      setResetResult({ success: false, message: 'Password must be at least 6 characters.' });
      return;
    }
    setIsResettingPass(true);
    setResetResult(null);
    try {
      const res = await resetStaffAccountPassword(resetTargetEmp, resetNewPass.trim());
      setResetResult(res);
    } finally {
      setIsResettingPass(false);
    }
  };

  // Permission Matrix Handlers
  const toggleMatrixCell = (moduleKey: PermissionModuleKey, action: PermissionAction) => {
    if (!activeSelectedRole) return;
    if (activeSelectedRole.roleKey === 'super_admin') return;
    if (
      isSalesmanOrCashierRole(activeSelectedRole.roleKey) &&
      (moduleKey === 'application_settings' || moduleKey === 'user_management')
    ) {
      return;
    }

    setDraftMatrix(prev => ({
      ...prev,
      [moduleKey]: {
        ...prev[moduleKey],
        [action]: !prev[moduleKey]?.[action],
      },
    }));
  };

  const toggleModuleRow = (moduleKey: PermissionModuleKey) => {
    if (!activeSelectedRole || activeSelectedRole.roleKey === 'super_admin') return;
    if (
      isSalesmanOrCashierRole(activeSelectedRole.roleKey) &&
      (moduleKey === 'application_settings' || moduleKey === 'user_management')
    ) {
      return;
    }
    const row = draftMatrix[moduleKey];
    const allEnabled = PERMISSION_ACTIONS.every(a => row?.[a.key]);
    setDraftMatrix(prev => ({
      ...prev,
      [moduleKey]: {
        view: !allEnabled,
        create: !allEnabled,
        edit: !allEnabled,
        delete: !allEnabled,
        print: !allEnabled,
        export: !allEnabled,
      },
    }));
  };

  const handleResetMatrixToDefault = () => {
    if (!activeSelectedRole) return;
    const tpl = getDefaultRoleTemplate(activeSelectedRole.roleKey);
    setDraftMatrix(clonePermissionsMatrix(tpl.permissions));
  };

  const handleSaveMatrix = async () => {
    if (!activeSelectedRole || !canEditStaff) return;
    setIsSavingMatrix(true);
    try {
      await updateRolePermissionsMatrix(activeSelectedRole.id, draftMatrix);
      setBannerMsg({
        type: 'success',
        text: `Permissions saved for role "${activeSelectedRole.name}". Changes apply immediately.`,
      });
    } catch (err: any) {
      setBannerMsg({ type: 'error', text: err?.message || 'Failed to update permissions.' });
    } finally {
      setIsSavingMatrix(false);
    }
  };

  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim() || !canCreateStaff) return;
    setIsCreatingRole(true);
    try {
      const baseTemplate = getDefaultRoleTemplate(cloneFromRoleKey);
      const created = await createCustomRole(
        newRoleName.trim(),
        newRoleDesc.trim() || `Custom role cloned from ${baseTemplate.name}`,
        clonePermissionsMatrix(baseTemplate.permissions)
      );
      setSelectedRoleId(created.id);
      setDraftMatrix(clonePermissionsMatrix(created.permissions));
      setIsCreateRoleOpen(false);
      setNewRoleName('');
      setNewRoleDesc('');
      setBannerMsg({ type: 'success', text: `Custom role "${created.name}" created successfully.` });
    } catch (err: any) {
      setBannerMsg({ type: 'error', text: err?.message || 'Failed to create role.' });
    } finally {
      setIsCreatingRole(false);
    }
  };

  const handleDeleteRole = async (role: RoleDefinition) => {
    if (role.isSystemRole || !canDeleteStaff) return;
    const res = await deleteCustomRole(role.id);
    if (res.success) {
      const fallback = roles.find(r => r.id !== role.id);
      if (fallback) handleSelectRole(fallback);
      setBannerMsg({ type: 'success', text: `Custom role "${role.name}" deleted.` });
    } else {
      setBannerMsg({ type: 'error', text: res.message || 'Could not delete role.' });
    }
  };

  const handleExportActivityCSV = () => {
    if (!canExportLogs) {
      setBannerMsg({ type: 'error', text: 'You do not have export permission for audit logs.' });
      return;
    }
    const headers = ['Date & Time', 'Employee ID', 'Employee Name', 'Role', 'Event Type', 'Module', 'Action', 'Details'];
    const rows = filteredActivityLogs.map(log => [
      `${formatDate(log.createdAt, lang)} ${formatTime(log.createdAt)}`,
      log.employeeCode || '-',
      log.employeeName,
      log.roleName,
      log.eventType,
      log.moduleKey,
      log.action,
      log.details,
    ]);
    exportToCSV(`staff-activity-logs-${todayStr}`, [headers, ...rows]);
  };

  // Grouped permission modules for clean matrix UI
  const moduleGroups = useMemo(() => {
    const groups = new Map<string, typeof PERMISSION_MODULES>();
    for (const mod of PERMISSION_MODULES) {
      if (!groups.has(mod.category)) groups.set(mod.category, []);
      groups.get(mod.category)!.push(mod);
    }
    return Array.from(groups.entries());
  }, []);

  // Data for inspecting an employee's sales & activity
  const inspectedSales = useMemo(() => {
    if (!inspectingEmp) return [];
    return sales.filter(
      s =>
        s.employeeId === inspectingEmp.id ||
        (inspectingEmp.userId && s.employeeId === inspectingEmp.userId) ||
        (inspectingEmp.employeeCode && s.employeeCode === inspectingEmp.employeeCode) ||
        s.sellerId === inspectingEmp.id
    );
  }, [inspectingEmp, sales]);

  const inspectedLogs = useMemo(() => {
    if (!inspectingEmp) return [];
    return activityLogs.filter(
      l =>
        l.employeeId === inspectingEmp.id ||
        (inspectingEmp.employeeCode && l.employeeCode === inspectingEmp.employeeCode) ||
        l.employeeName === inspectingEmp.name
    );
  }, [inspectingEmp, activityLogs]);

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>User &amp; Staff Management (RBAC)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Create staff accounts, assign granular role permissions across 19 modules, track employee sales &amp; audit every login
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => reloadRbacData()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync RBAC</span>
          </button>

          {canCreateStaff && (
            <button
              onClick={openAddEmployeeModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs md:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span>Add Employee Account</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {bannerMsg && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            bannerMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span className="font-medium">{bannerMsg.text}</span>
          </div>
          <button
            onClick={() => setBannerMsg(null)}
            className="p-1 hover:bg-black/5 rounded"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-xs flex flex-wrap gap-1">
        {[
          { id: 'overview', label: 'Admin Dashboard & Sales Tracking', icon: TrendingUp },
          { id: 'employees', label: `Staff Accounts (${employees.length})`, icon: Users },
          { id: 'roles', label: `Roles & Permissions (${roles.length})`, icon: Lock },
          { id: 'activity', label: `Login & Activity Logs (${activityLogs.length})`, icon: Activity },
          { id: 'security', label: 'Security & Database RLS', icon: Database },
        ].map(tab => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id as ActiveSubTab)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                active
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ==================== TAB 1: ADMIN OVERVIEW & EMPLOYEE SALES TRACKING ==================== */}
      {subTab === 'overview' && (
        <div className="space-y-4">
          {/* 4 KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Total Employees</span>
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono-num">
                {employeeStats.total}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Across {roles.length} configured roles
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Active Employees</span>
                <UserCheck className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono-num">
                {employeeStats.active}
              </div>
              <div className="text-[11px] text-emerald-600 mt-1">
                Authorized to log in &amp; process sales
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Inactive / Restricted</span>
                <UserX className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-2xl font-bold text-rose-700 mt-1 font-mono-num">
                {employeeStats.inactiveCount}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {employeeStats.inactive} Inactive • {employeeStats.suspended} Suspended • {employeeStats.blocked} Blocked
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Today&apos;s Sales (All Staff)</span>
                <Receipt className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono-num">
                {formatCurrency(employeeSalesBreakdown.todayTotalAmount, lang)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {employeeSalesBreakdown.todayTotalInvoices} invoices recorded today
              </div>
            </div>
          </div>

          {/* Top Performing Salesman + Recent Activity Split */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Top Performing Salesman Card */}
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-xl p-5 text-white shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-100">
                    Top Performing Salesman
                  </span>
                  <Award className="w-5 h-5 text-amber-300" />
                </div>

                {employeeSalesBreakdown.topToday && employeeSalesBreakdown.topToday.todayAmount > 0 ? (
                  <div className="mt-4">
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/15 text-[11px] font-mono-num">
                      {employeeSalesBreakdown.topToday.employeeCode}
                    </div>
                    <h3 className="text-xl font-bold mt-1">
                      {employeeSalesBreakdown.topToday.employeeName}
                    </h3>
                    <p className="text-xs text-emerald-100">{employeeSalesBreakdown.topToday.roleName}</p>
                    <div className="mt-4 pt-3 border-t border-white/20 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] text-emerald-100">Today&apos;s Sales</div>
                        <div className="text-lg font-bold font-mono-num">
                          {formatCurrency(employeeSalesBreakdown.topToday.todayAmount, lang)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-emerald-100">Invoices Today</div>
                        <div className="text-lg font-bold font-mono-num">
                          {employeeSalesBreakdown.topToday.todayCount}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : employeeSalesBreakdown.topOverall && employeeSalesBreakdown.topOverall.totalAmount > 0 ? (
                  <div className="mt-4">
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/15 text-[11px] font-mono-num">
                      {employeeSalesBreakdown.topOverall.employeeCode} • All-Time Leader
                    </div>
                    <h3 className="text-xl font-bold mt-1">
                      {employeeSalesBreakdown.topOverall.employeeName}
                    </h3>
                    <p className="text-xs text-emerald-100">{employeeSalesBreakdown.topOverall.roleName}</p>
                    <div className="mt-4 pt-3 border-t border-white/20 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] text-emerald-100">Cumulative Sales</div>
                        <div className="text-lg font-bold font-mono-num">
                          {formatCurrency(employeeSalesBreakdown.topOverall.totalAmount, lang)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-emerald-100">Total Invoices</div>
                        <div className="text-lg font-bold font-mono-num">
                          {employeeSalesBreakdown.topOverall.totalCount}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 text-xs text-emerald-100">
                    No employee sales recorded yet. Create a POS sale to track staff performance automatically.
                  </div>
                )}
              </div>

              <button
                onClick={() => setSubTab('employees')}
                className="mt-4 w-full py-2 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-semibold transition-colors"
              >
                Manage All Staff Accounts
              </button>
            </div>

            {/* Today's Sales by Employee Table */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Today&apos;s Sales by Employee</h3>
                  <p className="text-[11px] text-slate-500">
                    Automatic POS attribution (Employee ID, Name, Invoice Count, Discount &amp; Payment Method)
                  </p>
                </div>
                <span className="text-[11px] font-mono-num text-slate-500">{todayStr}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Employee</th>
                      <th className="px-4 py-2.5 font-semibold">Role</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Today Invoices</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Discount</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Today Sales</th>
                      <th className="px-4 py-2.5 font-semibold text-right">All-Time Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {employeeSalesBreakdown.list.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          No staff sales recorded yet.
                        </td>
                      </tr>
                    ) : (
                      employeeSalesBreakdown.list.map(row => (
                        <tr key={row.key} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5">
                            <div className="font-semibold text-slate-900">{row.employeeName}</div>
                            <div className="text-[11px] text-slate-500 font-mono-num">
                              ID: {row.employeeCode}
                              {row.paymentMethods.size > 0 && ` • ${Array.from(row.paymentMethods).join(', ')}`}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-700">{row.roleName}</td>
                          <td className="px-4 py-2.5 text-right font-mono-num font-semibold text-slate-800">
                            {row.todayCount}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono-num text-amber-700">
                            {formatCurrency(row.todayDiscount, lang)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono-num font-bold text-emerald-700">
                            {formatCurrency(row.todayAmount, lang)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono-num text-slate-700">
                            {formatCurrency(row.totalAmount, lang)} ({row.totalCount})
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Recent Sales Attribution + Recent Employee Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Recent Employee Transactions</h3>
                <span className="text-[11px] text-slate-500">Latest 10 Invoices</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {employeeSalesBreakdown.recentStaffSales.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">No transactions yet.</div>
                ) : (
                  employeeSalesBreakdown.recentStaffSales.map(sale => (
                    <div key={sale.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          <span className="font-mono-num">{sale.invoiceNumber}</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-medium">
                            {sale.employeeCode ? `${sale.employeeCode} • ` : ''}
                            {sale.employeeName || sale.sellerName || sale.servedBy || 'Store Admin'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {formatDate(sale.date, lang)} {formatTime(sale.date)} • {sale.paymentMethod} • Discount:{' '}
                          {formatCurrency(sale.discount || 0, lang)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold font-mono-num text-emerald-700">
                          {formatCurrency(sale.total, lang)}
                        </div>
                        <div className="text-[10px] text-slate-500 uppercase">{sale.status}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Recent Employee Activities</h3>
                <button
                  onClick={() => setSubTab('activity')}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  View Full Audit Trail →
                </button>
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {activityLogs.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No activity recorded yet. Logins, sales, role changes &amp; permission checks appear here.
                  </div>
                ) : (
                  activityLogs.slice(0, 12).map(log => (
                    <div key={log.id} className="px-4 py-2.5 text-xs flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-slate-900">{log.employeeName}</span>
                          {log.employeeCode && (
                            <span className="text-[10px] font-mono-num px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {log.employeeCode}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              log.eventType === 'PERMISSION_DENIED' || log.eventType === 'LOGIN_BLOCKED'
                                ? 'bg-rose-100 text-rose-700'
                                : log.eventType === 'SALE_CREATED'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {log.eventType}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-0.5">{log.details}</p>
                      </div>
                      <div className="text-[10px] text-slate-400 shrink-0 text-right font-mono-num">
                        <div>{formatDate(log.createdAt, lang)}</div>
                        <div>{formatTime(log.createdAt)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: STAFF ACCOUNTS DIRECTORY ==================== */}
      {subTab === 'employees' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col md:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
                placeholder="Search by Employee Name, ID (EMP-001), Username, Email or Phone..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <select
              value={empRoleFilter}
              onChange={e => setEmpRoleFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Roles</option>
              {roles.map(r => (
                <option key={r.id} value={r.roleKey}>
                  {r.name}
                </option>
              ))}
            </select>

            <select
              value={empStatusFilter}
              onChange={e => setEmpStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
              <option value="blocked">Blocked</option>
            </select>

            {branches.length > 0 && (
              <select
                value={empBranchFilter}
                onChange={e => setEmpBranchFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Employees Directory Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Employee &amp; ID</th>
                    <th className="px-4 py-3 font-semibold">Login / Contact</th>
                    <th className="px-4 py-3 font-semibold">Assigned Role</th>
                    <th className="px-4 py-3 font-semibold">Branch &amp; Joined</th>
                    {canViewSalary && <th className="px-4 py-3 font-semibold text-right">Salary</th>}
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={canViewSalary ? 7 : 6} className="px-4 py-10 text-center text-slate-500">
                        No staff accounts match your filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map(emp => {
                      const status = (emp.accountStatus || emp.status || 'active') as AccountStatus;
                      const badge = STATUS_BADGE_MAP[status] || STATUS_BADGE_MAP.active;
                      const roleDef =
                        roles.find(r => r.id === emp.roleId) ||
                        roles.find(r => r.roleKey === normalizeRoleKey(emp.roleKey || emp.role));
                      const branch = branches.find(b => b.id === emp.branchId);

                      return (
                        <tr key={emp.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-900">{emp.name}</div>
                            <div className="text-[11px] text-slate-500 font-mono-num flex items-center gap-1.5 mt-0.5">
                              <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-700">
                                {emp.employeeCode || emp.id.slice(0, 8)}
                              </span>
                              {emp.position && <span>• {emp.position}</span>}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="text-slate-800 flex items-center gap-1">
                              <Phone className="w-3 h-3 text-slate-400" />
                              <span>{emp.mobile || '—'}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[200px]">
                              {emp.username ? `@${emp.username}` : ''}{' '}
                              {emp.email ? `(${emp.email})` : ''}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
                              {roleDef?.name || emp.roleName || emp.role}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-slate-600">
                            <div className="flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-slate-400" />
                              <span>{branch?.name || emp.branchName || 'Main Branch'}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Joined: {formatDate(emp.joiningDate, lang)}
                            </div>
                          </td>

                          {canViewSalary && (
                            <td className="px-4 py-3 text-right font-mono-num font-semibold text-slate-800">
                              {formatCurrency(emp.salary || 0, lang)}
                            </td>
                          )}

                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            {emp.lastLoginAt && (
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Last: {formatDate(emp.lastLoginAt, lang)}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setInspectingEmp(emp)}
                                title="View Sales & Activity Logs"
                                className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg border border-slate-200 transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {canEditStaff && (
                                <>
                                  <button
                                    onClick={() => openEditEmployeeModal(emp)}
                                    title="Edit Employee & Role"
                                    className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg border border-slate-200 transition-colors"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  <button
                                    onClick={() => {
                                      setResetTargetEmp(emp);
                                      setResetNewPass(generateStrongPassword());
                                      setResetResult(null);
                                    }}
                                    title="Reset Employee Password"
                                    className="p-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg border border-slate-200 transition-colors"
                                  >
                                    <KeyRound className="w-3.5 h-3.5" />
                                  </button>

                                  {status !== 'active' ? (
                                    <button
                                      onClick={() => handleQuickStatusChange(emp, 'active')}
                                      title="Activate Account"
                                      className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg border border-emerald-200 transition-colors"
                                    >
                                      <UserCheck className="w-3.5 h-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleQuickStatusChange(emp, 'inactive')}
                                      title="Deactivate Account"
                                      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                                    >
                                      <PauseCircle className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  {status !== 'suspended' && (
                                    <button
                                      onClick={() => handleQuickStatusChange(emp, 'suspended')}
                                      title="Suspend Account"
                                      className="p-1.5 text-amber-700 hover:bg-amber-50 rounded-lg border border-amber-200 transition-colors"
                                    >
                                      <ShieldAlert className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  {status !== 'blocked' && (
                                    <button
                                      onClick={() => handleQuickStatusChange(emp, 'blocked')}
                                      title="Block Account"
                                      className="p-1.5 text-rose-700 hover:bg-rose-50 rounded-lg border border-rose-200 transition-colors"
                                    >
                                      <Ban className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: ROLES & GRANULAR PERMISSIONS MATRIX ==================== */}
      {subTab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Roles List */}
          <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">User Roles</h3>
                <p className="text-[11px] text-slate-500">6 default roles + custom store roles</p>
              </div>
              {canCreateStaff && (
                <button
                  onClick={() => setIsCreateRoleOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Custom Role</span>
                </button>
              )}
            </div>

            <div className="divide-y divide-slate-100 flex-1">
              {roles.map(role => {
                const isSelected = activeSelectedRole?.id === role.id;
                const assignedCount = employees.filter(
                  e => e.roleId === role.id || normalizeRoleKey(e.roleKey || e.role) === role.roleKey
                ).length;

                return (
                  <div
                    key={role.id}
                    onClick={() => handleSelectRole(role)}
                    className={`p-3.5 cursor-pointer transition-colors flex items-start justify-between gap-2 ${
                      isSelected ? 'bg-emerald-50 border-l-4 border-l-emerald-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900">{role.name}</span>
                        {role.isSystemRole ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                            System
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                            Custom
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{role.description}</p>
                      <div className="text-[10px] text-slate-500 mt-1.5 font-medium">
                        {assignedCount} assigned staff
                      </div>
                    </div>

                    {!role.isSystemRole && canDeleteStaff && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteRole(role);
                        }}
                        title="Delete Custom Role"
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: 19-Module × 6-Action Permission Matrix */}
          <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            {activeSelectedRole && (
              <>
                <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">
                        Permissions: {activeSelectedRole.name}
                      </h3>
                      {activeSelectedRole.roleKey === 'super_admin' && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">
                          Full Owner Access (Locked)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure individual View, Create, Edit, Delete, Print &amp; Export rights across all 19 modules
                    </p>
                  </div>

                  {canEditStaff && activeSelectedRole.roleKey !== 'super_admin' && (
                    <div className="flex items-center gap-2">
                      {activeSelectedRole.isSystemRole && (
                        <button
                          onClick={handleResetMatrixToDefault}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Default</span>
                        </button>
                      )}
                      <button
                        onClick={handleSaveMatrix}
                        disabled={isSavingMatrix}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs disabled:opacity-60"
                      >
                        {isSavingMatrix ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Save Permissions</span>
                      </button>
                    </div>
                  )}
                </div>

                {isSalesmanOrCashierRole(activeSelectedRole.roleKey) && (
                  <div className="mx-4 mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center gap-2">
                    <Lock className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      Security Policy: Salesman and Cashier roles are strictly blocked from Application Settings and User Management at both UI and database RLS layers.
                    </span>
                  </div>
                )}

                <div className="overflow-x-auto p-4">
                  <table className="w-full text-left text-xs border border-slate-200 rounded-lg overflow-hidden">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">Module (19 Total)</th>
                        {PERMISSION_ACTIONS.map(act => (
                          <th key={act.key} className="px-2.5 py-2.5 font-semibold text-center w-16">
                            {act.label}
                          </th>
                        ))}
                        <th className="px-2.5 py-2.5 font-semibold text-center w-16">Row</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {moduleGroups.map(([category, mods]) => (
                        <React.Fragment key={category}>
                          <tr className="bg-slate-100/70">
                            <td colSpan={8} className="px-3 py-1.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                              {category}
                            </td>
                          </tr>
                          {mods.map(mod => {
                            const row = draftMatrix[mod.key] || {
                              view: false,
                              create: false,
                              edit: false,
                              delete: false,
                              print: false,
                              export: false,
                            };
                            const isLockedAdmin = activeSelectedRole.roleKey === 'super_admin';
                            const isHardBlocked =
                              isSalesmanOrCashierRole(activeSelectedRole.roleKey) &&
                              (mod.key === 'application_settings' || mod.key === 'user_management');
                            const disabled = !canEditStaff || isLockedAdmin || isHardBlocked;

                            return (
                              <tr key={mod.key} className="hover:bg-slate-50/70">
                                <td className="px-3 py-2">
                                  <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                                    <span>{mod.name}</span>
                                    {isHardBlocked && <Lock className="w-3 h-3 text-rose-500" />}
                                  </div>
                                  <div className="text-[10px] text-slate-500">{mod.description}</div>
                                </td>
                                {PERMISSION_ACTIONS.map(act => {
                                  const checked = isLockedAdmin ? true : isHardBlocked ? false : Boolean(row[act.key]);
                                  return (
                                    <td key={act.key} className="px-2.5 py-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={disabled}
                                        onChange={() => toggleMatrixCell(mod.key, act.key)}
                                        aria-label={`${mod.name} ${act.label}`}
                                        className="w-4 h-4 accent-emerald-600 rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                                      />
                                    </td>
                                  );
                                })}
                                <td className="px-2.5 py-2 text-center">
                                  <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => toggleModuleRow(mod.key)}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40"
                                  >
                                    Toggle
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== TAB 4: LOGIN HISTORY & IMMUTABLE ACTIVITY LOGS ==================== */}
      {subTab === 'activity' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex flex-col md:flex-row gap-2.5 items-stretch md:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={actSearch}
                onChange={e => setActSearch(e.target.value)}
                placeholder="Search logs by employee, action, invoice or details..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <select
              value={actEventFilter}
              onChange={e => setActEventFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Event Types</option>
              <option value="LOGIN_SUCCESS">Login Success</option>
              <option value="LOGIN_BLOCKED">Login Blocked</option>
              <option value="SALE_CREATED">Sale Created</option>
              <option value="PERMISSION_DENIED">Permission Denied</option>
              <option value="FINANCIAL_DELETED">Financial Deleted</option>
              <option value="EMPLOYEE_CREATED">Employee Created</option>
              <option value="EMPLOYEE_UPDATED">Employee Updated</option>
              <option value="EMPLOYEE_STATUS_CHANGED">Status Changed</option>
              <option value="PASSWORD_RESET">Password Reset</option>
              <option value="ROLE_CREATED">Role Created</option>
              <option value="ROLE_PERMISSIONS_UPDATED">Role Permissions Updated</option>
            </select>

            <select
              value={actEmpFilter}
              onChange={e => setActEmpFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700"
            >
              <option value="all">All Staff</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.employeeCode ? `${emp.employeeCode} - ` : ''}
                  {emp.name}
                </option>
              ))}
            </select>

            {canExportLogs && (
              <button
                onClick={handleExportActivityCSV}
                className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                Permanent Append-Only Audit Log (Employees cannot modify or delete activity history)
              </span>
              <span className="font-mono-num">{filteredActivityLogs.length} entries</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Date &amp; Time</th>
                    <th className="px-4 py-2.5 font-semibold">Employee</th>
                    <th className="px-4 py-2.5 font-semibold">Role</th>
                    <th className="px-4 py-2.5 font-semibold">Event</th>
                    <th className="px-4 py-2.5 font-semibold">Module / Action</th>
                    <th className="px-4 py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredActivityLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No matching activity logs found.
                      </td>
                    </tr>
                  ) : (
                    filteredActivityLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono-num text-[11px] text-slate-600 whitespace-nowrap">
                          {formatDate(log.createdAt, lang)} {formatTime(log.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900">{log.employeeName}</div>
                          {log.employeeCode && (
                            <div className="text-[10px] text-slate-500 font-mono-num">{log.employeeCode}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{log.roleName}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.eventType === 'PERMISSION_DENIED' ||
                              log.eventType === 'LOGIN_BLOCKED' ||
                              log.eventType === 'FINANCIAL_DELETED'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : log.eventType === 'SALE_CREATED' || log.eventType === 'LOGIN_SUCCESS'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            {log.eventType}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800">{log.moduleKey}</span> • {log.action}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 max-w-md">{log.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 5: SECURITY & DATABASE RLS ==================== */}
      {subTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Active RBAC Security Controls</span>
            </h3>
            <div className="space-y-2.5 text-xs">
              {[
                {
                  title: 'Backend Row Level Security (Supabase RLS)',
                  desc: 'user_roles, role_permissions, employees, user_activity_logs, sales, expenses & businesses enforce has_module_permission() directly in PostgreSQL.',
                },
                {
                  title: 'Non-Privileged Role Lock',
                  desc: 'Role preview switcher is restricted strictly to authenticated Store Owners / Super Admins. Employees cannot escalate their role in the browser.',
                },
                {
                  title: 'Account Status Enforcement on Login',
                  desc: 'Inactive, Suspended & Blocked employees are immediately rejected by get_my_rbac_context() & signed out upon authentication.',
                },
                {
                  title: 'Salesman / Cashier Protection',
                  desc: 'Salesmen and Cashiers are blocked from Application Settings, User Management, and deleting financial records (sales, purchases, expenses, accounts).',
                },
                {
                  title: 'Immutable Sale Employee Attribution',
                  desc: 'PostgreSQL trigger enforce_sale_employee_tracking() and AppContext stamp Employee ID, Code, Name, Timestamp, Discount & Payment Method on every invoice.',
                },
              ].map((item, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-slate-900">{item.title}</div>
                    <p className="text-[11px] text-slate-600 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              <span>Supabase Schema &amp; Migration Tables</span>
            </h3>
            <p className="text-xs text-slate-600">
              All RBAC tables integrate with your existing <code className="px-1 py-0.5 bg-slate-100 rounded">businesses</code>,{' '}
              <code className="px-1 py-0.5 bg-slate-100 rounded">business_users</code>, and{' '}
              <code className="px-1 py-0.5 bg-slate-100 rounded">sales</code> tables via migration{' '}
              <code className="px-1 py-0.5 bg-slate-100 rounded">supabase/migrations/20261115_rbac_staff_management.sql</code>.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { name: 'user_roles', desc: '6 system roles + custom store roles' },
                { name: 'permissions', desc: '19 canonical permission modules' },
                { name: 'role_permissions', desc: 'View/Create/Edit/Delete/Print/Export flags' },
                { name: 'employees', desc: 'Employee ID, role_id, account_status, salary' },
                { name: 'user_activity_logs', desc: 'Append-only login & action history' },
                { name: 'sales (extended)', desc: 'employee_id, employee_code, employee_name' },
              ].map(tbl => (
                <div key={tbl.name} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/60">
                  <div className="font-mono-num font-bold text-slate-900 text-[11px]">{tbl.name}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{tbl.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: ADD EMPLOYEE ACCOUNT ==================== */}
      {isAddEmpOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Create Employee Account</h3>
              </div>
              <button
                onClick={() => setIsAddEmpOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEmployee} className="p-5 space-y-4">
              {empFormError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{empFormError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Employee Full Name *</label>
                  <input
                    type="text"
                    required
                    value={addFullName}
                    onChange={e => setAddFullName(e.target.value)}
                    placeholder="e.g. Rahim Uddin"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Employee ID *</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      required
                      value={addEmpCode}
                      onChange={e => setAddEmpCode(e.target.value)}
                      placeholder="EMP-001"
                      className="flex-1 px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setAddEmpCode(generateNextEmployeeCode(employees))}
                      className="px-2.5 py-2 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                    >
                      Auto
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    value={addPhone}
                    onChange={e => setAddPhone(e.target.value)}
                    placeholder="017XXXXXXXX"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                  <input
                    type="email"
                    value={addEmail}
                    onChange={e => setAddEmail(e.target.value)}
                    placeholder="staff@yourshop.com (optional)"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Login Username *</label>
                  <input
                    type="text"
                    required
                    value={addUsername}
                    onChange={e => setAddUsername(e.target.value)}
                    placeholder="e.g. rahim_pos"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Password *</label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <input
                        type={showAddPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={addPassword}
                        onChange={e => setAddPassword(e.target.value)}
                        className="w-full pl-3 pr-8 py-2 text-xs font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAddPassword(v => !v)}
                        className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
                      >
                        {showAddPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAddPassword(generateStrongPassword())}
                      className="px-2.5 py-2 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                    >
                      Gen
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role *</label>
                  <select
                    value={addRoleId}
                    onChange={e => {
                      setAddRoleId(e.target.value);
                      const found = roles.find(r => r.id === e.target.value);
                      if (found) setAddPosition(found.name);
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Account Status *</label>
                  <select
                    value={addStatus}
                    onChange={e => setAddStatus(e.target.value as AccountStatus)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="active">Active (Allowed to Login)</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>

                {canViewSalary && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Monthly Salary (Admin Only)</label>
                    <input
                      type="number"
                      min={0}
                      value={addSalary}
                      onChange={e => setAddSalary(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Joining Date *</label>
                  <input
                    type="date"
                    required
                    value={addJoiningDate}
                    onChange={e => setAddJoiningDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                {branches.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Branch</label>
                    <select
                      value={addBranchId}
                      onChange={e => setAddBranchId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Designation / Title</label>
                  <input
                    type="text"
                    value={addPosition}
                    onChange={e => setAddPosition(e.target.value)}
                    placeholder="e.g. Senior Counter Salesman"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddEmpOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEmp}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs disabled:opacity-60"
                >
                  {isSavingEmp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                  <span>Create Employee Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: EDIT EMPLOYEE ==================== */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Edit Staff Account: {editingEmp.name}</h3>
              <button onClick={() => setEditingEmp(null)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEditEmployee} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Employee ID</label>
                  <input
                    type="text"
                    value={editCode}
                    onChange={e => setEditCode(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone *</label>
                  <input
                    type="tel"
                    required
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={e => setEditUsername(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Role *</label>
                  <select
                    value={editRoleId}
                    onChange={e => setEditRoleId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Account Status</label>
                  <select
                    value={editStatus}
                    onChange={e => setEditStatus(e.target.value as AccountStatus)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>
                {canViewSalary && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Monthly Salary (Admin Only)</label>
                    <input
                      type="number"
                      min={0}
                      value={editSalary}
                      onChange={e => setEditSalary(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Joining Date</label>
                  <input
                    type="date"
                    value={editJoiningDate}
                    onChange={e => setEditJoiningDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                {branches.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Branch</label>
                    <select
                      value={editBranchId}
                      onChange={e => setEditBranchId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingEmp}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-60"
                >
                  {isUpdatingEmp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: RESET PASSWORD ==================== */}
      {resetTargetEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Reset Password: {resetTargetEmp.name}</h3>
              </div>
              <button onClick={() => setResetTargetEmp(null)} className="p-1 text-slate-400 hover:text-slate-700 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleResetPasswordSubmit} className="p-5 space-y-3">
              <div className="text-xs text-slate-600">
                Account: <span className="font-semibold text-slate-900">{resetTargetEmp.email || resetTargetEmp.username}</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">New Temporary Password</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    minLength={6}
                    value={resetNewPass}
                    onChange={e => setResetNewPass(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs font-mono-num border border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setResetNewPass(generateStrongPassword())}
                    className="px-2.5 py-2 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    Generate
                  </button>
                </div>
              </div>

              {resetResult && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    resetResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  {resetResult.message}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetTargetEmp(null)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isResettingPass}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
                >
                  {isResettingPass ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                  <span>Reset Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: CREATE CUSTOM ROLE ==================== */}
      {isCreateRoleOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Create Custom Role</h3>
              <button onClick={() => setIsCreateRoleOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomRole} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role Name *</label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={e => setNewRoleName(e.target.value)}
                  placeholder="e.g. Shift Supervisor"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newRoleDesc}
                  onChange={e => setNewRoleDesc(e.target.value)}
                  placeholder="Responsibilities for this role..."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Permissions From Template</label>
                <select
                  value={cloneFromRoleKey}
                  onChange={e => setCloneFromRoleKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  <option value="salesman">Salesman</option>
                  <option value="cashier">Cashier</option>
                  <option value="store_manager">Store Manager</option>
                  <option value="accountant">Accountant</option>
                  <option value="inventory_manager">Inventory Manager</option>
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateRoleOpen(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingRole}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                >
                  {isCreatingRole ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Create Role</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL: INSPECT EMPLOYEE SALES & ACTIVITY ==================== */}
      {inspectingEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>{inspectingEmp.name}</span>
                  <span className="text-xs font-mono-num px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {inspectingEmp.employeeCode || inspectingEmp.id.slice(0, 8)}
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {inspectingEmp.mobile}
                  </span>
                  {inspectingEmp.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {inspectingEmp.email}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Joined {formatDate(inspectingEmp.joiningDate, lang)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setInspectingEmp(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">Invoices Recorded</div>
                  <div className="text-lg font-bold font-mono-num text-slate-900">{inspectedSales.length}</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="text-[11px] text-emerald-700">Total Sales Value</div>
                  <div className="text-lg font-bold font-mono-num text-emerald-800">
                    {formatCurrency(
                      inspectedSales.reduce((s, item) => s + Number(item.total || 0), 0),
                      lang
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">Activity Events</div>
                  <div className="text-lg font-bold font-mono-num text-slate-900">{inspectedLogs.length}</div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                  Sales Completed by {inspectingEmp.name}
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Invoice #</th>
                        <th className="px-3 py-2 font-semibold">Date &amp; Time</th>
                        <th className="px-3 py-2 font-semibold">Payment</th>
                        <th className="px-3 py-2 font-semibold text-right">Discount</th>
                        <th className="px-3 py-2 font-semibold text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inspectedSales.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
                            No sales recorded by this employee yet.
                          </td>
                        </tr>
                      ) : (
                        inspectedSales.slice(0, 20).map(s => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 font-mono-num font-semibold text-slate-900">{s.invoiceNumber}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {formatDate(s.date, lang)} {formatTime(s.date)}
                            </td>
                            <td className="px-3 py-2 uppercase text-[11px] text-slate-700">{s.paymentMethod}</td>
                            <td className="px-3 py-2 text-right font-mono-num text-amber-700">
                              {formatCurrency(s.discount || 0, lang)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono-num font-bold text-emerald-700">
                              {formatCurrency(s.total, lang)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                  Recent Login &amp; System Activity
                </h4>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {inspectedLogs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">No activity logs recorded.</div>
                  ) : (
                    inspectedLogs.slice(0, 20).map(l => (
                      <div key={l.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold text-slate-800 mr-2">{l.eventType}</span>
                          <span className="text-slate-600">{l.details}</span>
                        </div>
                        <span className="text-[10px] font-mono-num text-slate-400 shrink-0">
                          {formatDate(l.createdAt, lang)} {formatTime(l.createdAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
