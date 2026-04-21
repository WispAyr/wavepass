const bcrypt = require('bcrypt');

function requireAdmin(req, res, next) {
  if (req.session?.adminId) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

function requireVendor(req, res, next) {
  if (req.session?.vendorId) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/vendor/login');
}

async function verifyAdmin(username, password, db) {
  const admin = db.getAdmin(username);
  if (!admin) return false;
  return bcrypt.compare(password, admin.password);
}

async function verifyVendorPin(pin, vendor) {
  if (!vendor?.pin) return false;
  return bcrypt.compare(pin, vendor.pin);
}

module.exports = { requireAdmin, requireVendor, verifyAdmin, verifyVendorPin };
