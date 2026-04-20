const BusinessOwner = require('../models/BusinessOwner');
const Employee = require('../models/Employee');
const BusinessOwnerEmployeeWishlist = require('../models/BusinessOwnerEmployeeWishlist');

const getBusinessOwnerFromUser = async (userId) => {
  const businessOwner = await BusinessOwner.findOne({ userId });
  if (!businessOwner) {
    const err = new Error('Business owner profile not found');
    err.status = 404;
    throw err;
  }
  return businessOwner;
};

exports.getWishlist = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const wishlist = await BusinessOwnerEmployeeWishlist.getOrCreateForBusinessOwner(businessOwner._id);

    await wishlist.populate({
      path: 'items.employeeId',
      select: 'fullName email mobileNumber profilePhoto isActive'
    });

    res.status(200).json({
      success: true,
      data: {
        wishlist
      }
    });
  } catch (error) {
    console.error('Get business owner wishlist error:', error);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error fetching wishlist'
    });
  }
};

exports.addEmployee = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { employeeId } = req.params;
    const { notes } = req.body;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const wishlist = await BusinessOwnerEmployeeWishlist.getOrCreateForBusinessOwner(businessOwner._id);
    await wishlist.addItem(employeeId, notes || '');

    res.status(201).json({
      success: true,
      message: 'Employee added to wishlist'
    });
  } catch (error) {
    console.error('Add employee to wishlist error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error adding employee to wishlist'
    });
  }
};

exports.removeEmployee = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { employeeId } = req.params;

    const wishlist = await BusinessOwnerEmployeeWishlist.getOrCreateForBusinessOwner(businessOwner._id);
    await wishlist.removeItem(employeeId);

    res.status(200).json({
      success: true,
      message: 'Employee removed from wishlist'
    });
  } catch (error) {
    console.error('Remove employee from wishlist error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error removing employee from wishlist'
    });
  }
};

exports.checkEmployee = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const { employeeId } = req.params;

    const wishlist = await BusinessOwnerEmployeeWishlist.getOrCreateForBusinessOwner(businessOwner._id);
    const exists = wishlist.hasItem(employeeId);

    res.status(200).json({
      success: true,
      data: { exists }
    });
  } catch (error) {
    console.error('Check employee wishlist error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error checking wishlist'
    });
  }
};

exports.clearWishlist = async (req, res) => {
  try {
    const businessOwner = await getBusinessOwnerFromUser(req.user._id);
    const wishlist = await BusinessOwnerEmployeeWishlist.getOrCreateForBusinessOwner(businessOwner._id);
    wishlist.items = [];
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Wishlist cleared'
    });
  } catch (error) {
    console.error('Clear wishlist error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error clearing wishlist'
    });
  }
};
