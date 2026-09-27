

# Housing & Roommate Platform

## Backend Requirements Specification

### 1. Project Overview

The client wants a backend platform that helps people find suitable housing and roommates.

The platform will allow property owners to publish and manage available properties and rooms, while tenants can search for suitable accommodation, create roommate profiles, discover compatible roommates, request property viewings, submit rental applications, and complete rental payments.

The system should also provide administrative capabilities for managing users, properties, applications, payments, and overall platform activity.

The primary goal is to provide a reliable platform that manages the complete journey from **property listing → room discovery → roommate matching → viewing → application → approval → rental → payment**.

---

# 2. User Roles

The platform will have three primary types of users.

## 2.1 Tenant

A tenant is a person looking for accommodation.

A tenant should be able to:

* Create an account
* Manage their personal profile
* Create and manage a roommate profile
* Search for properties
* Search for available rooms
* Filter properties according to their requirements
* View property and room details
* Find potential compatible roommates
* View roommate profiles
* Request property/room viewings
* Submit rental applications
* Track application status
* Make rental payments
* View rental/payment history
* Receive notifications
* Manage their account

---

## 2.2 Property Owner

A property owner is a person who provides housing.

An owner should be able to:

* Create an account
* Manage their profile
* Create property listings
* Update property information
* Add rooms to a property
* Update room information
* Set room availability
* Set rental prices
* View applicants
* Review tenant applications
* Approve or reject applications
* Manage viewing requests
* Track occupied and available rooms
* View rental/payment information
* Receive notifications
* Manage their listings

---

## 2.3 Administrator

The administrator manages and supervises the platform.

An administrator should be able to:

* View registered users
* Manage user accounts
* Suspend or activate users
* Review property listings
* Moderate problematic listings
* Monitor applications
* Monitor payments
* View platform statistics
* View important system activities
* Review audit/activity records
* Manage platform-level issues

---

# 3. Account & Profile Requirements

## 3.1 User Registration

Users should be able to create an account.

The registration process should collect appropriate information such as:

* Name
* Email
* Phone number
* Password
* User type

The system should prevent duplicate accounts using the same unique account information.

---

## 3.2 User Login

Registered users should be able to securely log into the platform.

The system should identify the user's role after authentication and restrict access to functionality according to their role.

---

## 3.3 User Profile

Users should have a personal profile containing information relevant to the platform.

Users should be able to:

* View their profile
* Update their profile
* Update contact information
* Add a profile picture where applicable
* Update other personal information

---

# 4. Property Management

## 4.1 Create Property

Property owners should be able to create a property listing.

A property may contain information such as:

* Property title
* Description
* Property type
* Location
* Address
* City
* Area
* Number of rooms
* Available amenities
* Images
* Rental information
* Availability
* Listing status

---

## 4.2 Manage Property

The owner should be able to:

* View their properties
* View individual property details
* Update property information
* Update property availability
* Add/remove property images
* Publish a property
* Disable a property
* Remove a property from active listings

Removing a property should preserve its historical information where necessary.

---

# 5. Room Management

A property may contain one or more rooms.

## 5.1 Add Room

The owner should be able to add rooms to a property.

Each room may contain:

* Room name/number
* Room type
* Monthly rent
* Maximum occupants
* Current occupants
* Amenities
* Availability
* Description
* Images
* Availability date

---

## 5.2 Room Availability

The owner should be able to manage whether a room is:

* Available
* Reserved
* Occupied
* Temporarily unavailable
* Under maintenance

The system should prevent a tenant from applying for or reserving a room that is no longer available.

---

# 6. Property Search

Tenants should be able to search available properties.

The search should support relevant criteria such as:

* Location
* City
* Area
* Minimum rent
* Maximum rent
* Property type
* Room type
* Number of occupants
* Amenities
* Availability

Users should be able to sort search results according to relevant criteria such as:

* Price
* Newest listings
* Availability

Search results should be divided into manageable pages when there are many properties.

---

# 7. Property Details

A tenant should be able to view complete information about a property.

Property details should include:

* Property information
* Location
* Available rooms
* Room prices
* Room availability
* Amenities
* Images
* Owner information where appropriate
* Existing relevant rental information

Only rooms currently available for rental should be presented as available for new applications.

---

# 8. Roommate Profile

Tenants looking for roommates should be able to create a separate roommate profile.

The profile may contain:

* Age
* Occupation
* Budget
* Preferred location
* Preferred move-in date
* Smoking preference
* Pet preference
* Lifestyle preferences
* Sleeping schedule
* Gender preference
* Other roommate preferences

A tenant should be able to:

* Create their roommate profile
* View their roommate profile
* Update their preferences
* Enable/disable their roommate search

---

# 9. Roommate Matching

The platform should help tenants discover potentially compatible roommates.

The system should compare relevant roommate preferences.

Matching factors may include:

* Budget compatibility
* Preferred location
* Move-in date
* Lifestyle preferences
* Smoking preference
* Pet preference
* Sleeping schedule
* Other relevant preferences

The system should produce a compatibility result or score.

For example:

```text
Potential Roommate
------------------
Name: John

Compatibility: 87%

Budget: Compatible
Location: Compatible
Lifestyle: Highly Compatible
Move-in Date: Compatible
```

Tenants should be able to view a list of potential matches and inspect their roommate profiles.

---

# 10. Property Viewing

Tenants should be able to request a viewing of an available property or room.

A viewing request should contain:

* Property/room
* Tenant
* Preferred date
* Preferred time
* Optional message

The owner should be able to:

* View viewing requests
* Approve a request
* Reject a request
* Reschedule where applicable
* Mark a viewing as completed

The tenant should be able to:

* View their requests
* View request status
* Cancel a request where applicable

---

# 11. Rental Application

After finding a suitable room, a tenant should be able to submit an application.

An application should contain:

* Tenant information
* Property
* Room
* Application date
* Relevant tenant information
* Optional message/documents where applicable

The owner should be able to review submitted applications.

---

# 12. Application Status

Every rental application should have a clear status.

Possible statuses include:

```text
Pending
Approved
Rejected
Cancelled
Expired
```

The status should change according to valid business actions.

For example:

```text
Pending
   ↓
Approved
```

or:

```text
Pending
   ↓
Rejected
```

The system should prevent invalid status transitions.

---

# 13. Application Business Rules

The system should enforce rules such as:

### Duplicate application

A tenant should not be able to submit multiple active applications for the same room.

### Unavailable room

A tenant should not be able to apply for a room that is already occupied or unavailable.

### Approved application

When an application is approved, the corresponding room's availability must be updated appropriately.

### Competing applications

If multiple tenants have applied for the same room, approving one application should appropriately handle the remaining pending applications.

### Authorization

Only the appropriate owner should be able to approve or reject applications for their own property.

---

# 14. Rental Management

Once an application has been successfully approved, the platform should create a rental relationship between the tenant and the property/room.

A rental record should contain information such as:

* Tenant
* Owner
* Property
* Room
* Monthly rent
* Rental start date
* Rental end date, if applicable
* Rental status
* Payment information

Possible rental statuses:

```text
Pending
Active
Completed
Terminated
```

---

# 15. Rent Management

The system should track recurring rental payments.

For each rental period, the system should maintain:

* Amount due
* Due date
* Payment status
* Payment date
* Payment reference
* Tenant
* Rental

Possible payment states:

```text
Pending
Paid
Failed
Cancelled
```

Tenants should be able to view their rental payment history.

Owners should be able to view payment information associated with their properties.

---

# 16. Payment Requirements

The platform must support actual online rental-related payments.

The payment process should include:

```text
Payment Initiation
       ↓
Payment Processing
       ↓
Payment Result
       ↓
Verification
       ↓
Payment Record Updated
```

The system should handle:

* Successful payments
* Failed payments
* Cancelled payments
* Payment verification
* Duplicate payment attempts
* Payment history

The system must not allow users to manually change a payment from `PENDING` to `PAID`.

Payment status should be determined through the payment process.

---

# 17. Notifications

The platform should notify users about important events.

Examples:

### Tenant notifications

* Viewing request approved
* Viewing request rejected
* Application submitted
* Application approved
* Application rejected
* Payment successful
* Rent due soon
* Rental status changed

### Owner notifications

* New viewing request
* New rental application
* Application cancelled
* Payment received
* Room availability changed

Users should be able to view their notifications and mark them as read.

---

# 18. Administrative Management

The administrator should have access to platform-level management functions.

## User Management

Admin should be able to:

* View users
* Search users
* View user details
* Activate users
* Suspend users

---

## Property Moderation

Admin should be able to:

* View properties
* Review listings
* Identify problematic listings
* Approve/moderate listings where required
* Suspend inappropriate listings

---

## Platform Statistics

The administrator should be able to view high-level statistics such as:

```text
Total Users
Total Tenants
Total Owners
Total Properties
Total Rooms
Available Rooms
Occupied Rooms
Pending Applications
Active Rentals
Total Payments
```

---

# 19. Activity & Audit Tracking

The platform should maintain a record of important system activities.

Examples:

```text
Owner created property
Owner updated property
Owner approved application
Owner rejected application
Admin suspended user
Admin moderated property
Tenant submitted application
Payment completed
```

Each activity should identify relevant information such as:

* User
* Action
* Resource
* Resource identifier
* Time
* Previous state where relevant
* New state where relevant

Administrators should be able to review these records.

---

# 20. Automated System Operations

The platform should perform certain recurring operations automatically.

Examples:

### Rent reminders

Users should receive reminders when upcoming rent payments are approaching.

Example:

```text
Rent Due:
September 25

Reminder:
Your rent payment of ৳15,000 is due in 3 days.
```

### Expired applications

Applications that remain pending beyond the defined period may automatically become expired.

### Expired listings

Listings that pass their availability/expiration date may automatically become inactive.

These operations should happen automatically without requiring an administrator to trigger them manually.

---

# 21. Data Consistency Requirements

The system should maintain correct relationships between properties, rooms, tenants, applications, rentals, and payments.

For example:

```text
A room cannot have two active tenants
```

and:

```text
A room cannot be simultaneously available and occupied
```

and:

```text
An approved application should correspond to a valid rental
```

and:

```text
A completed payment should correspond to a valid payment obligation
```

Operations involving multiple related records should preserve consistency if one part of the operation fails.

---

# 22. Access Control Requirements

Users must only be allowed to perform actions appropriate to their role.

Examples:

### Tenant

Can:

```text
Search properties
Apply for rooms
Request viewing
Manage roommate profile
Make payments
```

Cannot:

```text
Create someone else's property
Approve applications
Manage another owner's room
Suspend users
```

### Owner

Can:

```text
Manage own properties
Manage own rooms
Review applications for own properties
Manage viewing requests for own properties
View rental/payment information for own properties
```

Cannot:

```text
Modify another owner's property
Manage platform users
Access administrator functions
```

### Admin

Can perform platform-level administrative operations.

---

# 23. Search, Filtering & Listing Requirements

All major listing functionality should provide an appropriate way to:

* Search
* Filter
* Sort
* Paginate

For example, tenants should be able to search:

```text
Dhaka
↓
Mirpur
↓
৳10,000–৳20,000
↓
2-person room
↓
WiFi
↓
Available
```

The platform should return only records matching the selected criteria.

---

# 24. Record Deletion

Important historical records should not simply disappear from the system.

For example:

* Properties
* Applications
* Rentals
* Payments
* Audit records

should retain appropriate historical information even when they are no longer active.

---

# 25. Error & Business Rule Handling

The platform should return meaningful responses when an operation cannot be completed.

Examples:

```text
Property not found
Room is no longer available
Application already exists
You are not authorized to perform this action
Viewing request has already been processed
Payment has already been completed
Rental does not exist
User does not exist
```

The system should distinguish between:

* Invalid user input
* Unauthorized access
* Missing resources
* Business rule violations
* System failures

---

# 26. Important Edge Cases

The system should properly handle situations such as:

### Property

* Owner tries to delete a property with an active rental
* Property has no available rooms
* Property becomes unavailable after being listed

### Room

* Two tenants try to apply/reserve the same room
* Room becomes occupied while another tenant is viewing it
* Owner attempts to mark an occupied room as available

### Application

* Tenant submits duplicate application
* Owner approves an already rejected application
* Application expires
* Owner attempts to approve an application for an unavailable room

### Payment

* Payment callback is received twice
* Payment fails
* Payment is cancelled
* Payment is already completed
* Payment amount does not match the expected amount

### User

* Duplicate registration
* Suspended user attempts to access the platform
* User attempts to access another user's private information

---

# 27. Core User Journey

The complete expected business journey is:

```text
                    OWNER
                      │
                      ▼
               Create Property
                      │
                      ▼
                 Add Rooms
                      │
                      ▼
             Publish Availability
                      │
                      │
                      ▼
                  TENANT
                      │
                      ▼
                Search Housing
                      │
                      ▼
                View Property
                      │
                      ▼
             Find Roommate Match
                      │
                      ▼
              Request Viewing
                      │
                      ▼
              Submit Application
                      │
                      ▼
                   OWNER
                      │
                ┌─────┴─────┐
                ▼           ▼
             Reject       Approve
                            │
                            ▼
                         RENTAL
                            │
                            ▼
                         PAYMENT
                            │
                            ▼
                     Active Tenant
```

---

# 28. Expected Backend Capabilities

From a client perspective, the finished system should provide APIs covering at minimum:

### Authentication

* Registration
* Login
* Social authentication
* Session/token management
* Logout

### User

* Profile management
* User account management

### Housing

* Property management
* Room management
* Property search
* Filtering
* Sorting
* Pagination

### Roommates

* Roommate profile
* Preference management
* Compatible roommate discovery

### Viewing

* Viewing requests
* Viewing approval/rejection
* Viewing status

### Applications

* Rental application
* Application review
* Application status management

### Rentals

* Rental creation
* Active rental management
* Rental history

### Payments

* Payment initiation
* Payment processing
* Payment verification
* Payment status
* Payment history

### Notifications

* User notifications
* Notification status

### Administration

* User management
* Property moderation
* Statistics
* Activity/audit records

---

# 29. Non-Functional Expectations

The platform should be:

### Secure

Private user information and account operations must be protected.

### Reliable

Important operations such as application approval, room occupancy, rental creation, and payment processing must not leave the system in an inconsistent state.

### Scalable

The design should be able to handle increasing numbers of:

* Users
* Properties
* Rooms
* Applications
* Payments
* Search requests

### Performant

Frequently requested information such as property listings should be returned efficiently.

### Traceable

Important changes should be recorded so administrators can understand what happened and who performed an action.

---

# 30. MVP Scope

If this were an actual client project, I would define the **MVP** as:

### Must Have

* User registration/login
* Three user roles
* User profiles
* Property management
* Room management
* Property search
* Filtering
* Pagination
* Roommate profiles
* Roommate matching
* Viewing requests
* Rental applications
* Application approval/rejection
* Rental management
* Online payment
* Payment status tracking
* Notifications
* Admin management
* Audit/activity tracking
* Automated rent reminders
* Proper handling of room availability and concurrent applications



## Final Client Requirement

**In short, the client is asking for a backend platform that manages the complete housing and roommate lifecycle:**

> **Owners can list properties and rooms → tenants can discover housing → tenants can find compatible roommates → tenants can request viewings → tenants can apply for rooms → owners can approve/reject applications → approved tenants become renters → renters can make rental payments → the platform tracks rentals, payments, notifications, availability, and important activities → administrators oversee the entire platform.**

This is the requirement specification I would use as your **source of truth**. From this document, you can independently make the next engineering decisions: **ERD → database models → business rules → API design → architecture → implementation.**
