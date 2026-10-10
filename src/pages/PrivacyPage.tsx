import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white shadow-sm sm:rounded-lg p-8">
        <div className="mb-8">
          <Link to="/" className="text-indigo-600 hover:text-indigo-500">
            &larr; Back to Home
          </Link>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Privacy Policy</h1>
        
        <div className="prose prose-indigo">
          <p className="text-gray-600 mb-4">
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">1. Data Collection</h2>
          <p className="text-gray-600 mb-4">
            We collect only the data necessary to provide our scheduling services:
          </p>
          <ul className="list-disc pl-5 text-gray-600 mb-4">
            <li>Account information (email, name)</li>
            <li>Organization details</li>
            <li>Employee schedules and availability</li>
            <li>Location information</li>
          </ul>

          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">2. Data Usage</h2>
          <p className="text-gray-600 mb-4">
            Your data is used solely for:
          </p>
          <ul className="list-disc pl-5 text-gray-600 mb-4">
            <li>Providing scheduling functionality</li>
            <li>Authentication and security</li>
            <li>Service improvements (aggregated, anonymous data only)</li>
          </ul>

          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">3. Data Rights</h2>
          <p className="text-gray-600 mb-4">
            You have the right to:
          </p>
          <ul className="list-disc pl-5 text-gray-600 mb-4">
            <li>Access your personal data</li>
            <li>Request correction of your data</li>
            <li>Request deletion of your account and data</li>
            <li>Export your data</li>
          </ul>

          <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-4">4. Contact Us</h2>
          <p className="text-gray-600 mb-4">
            If you have any questions about this Privacy Policy, please contact us at privacy@scheduleapp.com.
          </p>
        </div>
      </div>
    </div>
  );
}
